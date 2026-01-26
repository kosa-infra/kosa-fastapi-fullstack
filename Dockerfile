FROM python:3.12

WORKDIR /code

COPY ./requirements.txt /code/requirements.txt

RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

COPY ./app /code/app

COPY ./static /code/static

COPY ./templates /code/templates

CMD ["fastapi", "run", "app/main.py", "--port", "80"]