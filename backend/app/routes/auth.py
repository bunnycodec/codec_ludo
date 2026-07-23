"""Login, logout, change-password, and "who am I" endpoints."""

from fastapi import APIRouter, HTTPException, Response, status
from sqlmodel import func, select

from ..auth import (
    COOKIE_NAME,
    create_jwt,
    hash_password,
    new_session_token,
    verify_password,
)
from ..config import settings
from ..deps import CurrentUser, DbSession
from ..models import User
from ..schemas import ChangePasswordRequest, LoginRequest, LoginResponse, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,  # JS in the browser can't read it — blocks token theft via XSS
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.jwt_expiry_days * 24 * 3600,
    )


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, response: Response, session: DbSession):
    # Username matching is case-insensitive at login (like Gmail) — the stored
    # casing (whatever the admin typed when creating the account) is still what
    # displays everywhere; only the comparison ignores case.
    user = session.exec(
        select(User).where(func.lower(User.username) == body.username.lower())
    ).first()
    # Same error for wrong username and wrong password, so an attacker can't probe
    # which usernames exist.
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password.")

    # Fresh session token: any previously issued JWT for this user stops matching
    # and is effectively logged out.
    user.current_session_token = new_session_token()
    session.add(user)
    session.commit()
    session.refresh(user)

    set_session_cookie(response, create_jwt(user.id, user.current_session_token))
    return LoginResponse(
        user=UserOut.model_validate(user, from_attributes=True),
        must_change_password=user.must_change_password,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, user: CurrentUser, session: DbSession):
    user.current_session_token = None
    session.add(user)
    session.commit()
    response.delete_cookie(COOKIE_NAME)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return UserOut.model_validate(user, from_attributes=True)


@router.post("/change-password", response_model=UserOut)
def change_password(
    body: ChangePasswordRequest, response: Response, user: CurrentUser, session: DbSession
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect.")

    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    # Rotate the session so any other device that somehow had a token is kicked out,
    # while this device gets a fresh cookie and stays logged in.
    user.current_session_token = new_session_token()
    session.add(user)
    session.commit()
    session.refresh(user)

    set_session_cookie(response, create_jwt(user.id, user.current_session_token))
    return UserOut.model_validate(user, from_attributes=True)
