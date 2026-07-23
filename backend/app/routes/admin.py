"""Admin-only account management: create players, reset passwords, list family."""

from fastapi import APIRouter, HTTPException, status
from sqlmodel import func, select

from ..auth import hash_password
from ..deps import AdminUser, DbSession
from ..models import User
from ..schemas import CreateUserRequest, ResetPasswordRequest, UserOut

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
def list_users(admin: AdminUser, session: DbSession):
    users = session.exec(select(User).order_by(User.username)).all()
    return [UserOut.model_validate(u, from_attributes=True) for u in users]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: CreateUserRequest, admin: AdminUser, session: DbSession):
    # Case-insensitive uniqueness (like Gmail) — "Alice" and "alice" can't both
    # exist, matching the same case-insensitive rule login uses.
    exists = session.exec(
        select(User).where(func.lower(User.username) == body.username.lower())
    ).first()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken.")

    user = User(
        username=body.username,
        password_hash=hash_password(body.temp_password),
        must_change_password=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)


@router.post("/users/{user_id}/reset-password", response_model=UserOut)
def reset_password(user_id: int, body: ResetPasswordRequest, admin: AdminUser, session: DbSession):
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such user.")

    user.password_hash = hash_password(body.temp_password)
    user.must_change_password = True
    # Kill any active session — the account holder must log in fresh with the temp
    # password the admin hands them.
    user.current_session_token = None
    session.add(user)
    session.commit()
    session.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, admin: AdminUser, session: DbSession):
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't delete your own account.")

    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such user.")

    session.delete(user)
    session.commit()
