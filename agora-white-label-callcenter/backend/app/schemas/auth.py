from pydantic import BaseModel, EmailStr, Field, model_validator


class SendCodeRequest(BaseModel):
    email: EmailStr
    type: str = Field(..., pattern='^(register|login)$')
    password: str | None = Field(default=None, max_length=128)


class SendCodeResponse(BaseModel):
    ok: bool = True
    message: str = 'verification code sent'
    # SMTP 未配置时返回，仅用于本地开发
    dev_code: str | None = None


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    code: str = Field(..., min_length=4, max_length=16)
    app_id: str = Field(..., min_length=1, max_length=64)

    @model_validator(mode='before')
    @classmethod
    def accept_app_id_alias(cls, data):
        if isinstance(data, dict) and not data.get('app_id') and data.get('appId'):
            data = dict(data)
            data['app_id'] = data['appId']
        return data


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)
    code: str = Field(..., min_length=4, max_length=16)


class AdminLoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    email: str
    username: str
    app_id: str
    role: str = 'user'

    model_config = {'from_attributes': True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: UserOut
