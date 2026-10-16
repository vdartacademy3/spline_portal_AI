import os, sys

sys.path.insert(0, r"D:\HR\pixel-perfect-clone\backend")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "spineai.settings")
os.environ.setdefault("DJANGO_ALLOW_ASYNC_UNSAFE", "1")

import django

django.setup()


def rethrow_handler(exc, context):
    raise exc
