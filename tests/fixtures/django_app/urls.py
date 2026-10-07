from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health),
    path("items/<int:pk>/", views.item),
]
