from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    MYSQL_HOST: str
    MYSQL_PORT: int = 3306
    MYSQL_USER: str
    MYSQL_PASSWORD: str
    MYSQL_DB: str

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
