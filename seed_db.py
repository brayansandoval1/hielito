from app import app, db
from backend.models import Product, User
from werkzeug.security import generate_password_hash

def seed_products():
    with app.app_context():
        # Lista de productos iniciales
        initial_products = [
            {
                "id": 1,
                "name": "Hielo en Bolsa",
                "description": "Variedad de presentaciones para tu hogar o evento.",
                "price": 25.0,
                "stock": 100,
                "image_url": "img/bolsa.jpeg"
            },
            {
                "id": 2,
                "name": "Vasos de Hielo",
                "description": "Listos para servir en tus fiestas.",
                "price": 80.0,
                "stock": 50,
                "image_url": "img/vaso.jpeg"
            },
            {
                "id": 3,
                "name": "Hielo Triturado",
                "description": "Textura perfecta para raspados.",
                "price": 35.0,
                "stock": 200,
                "image_url": "img/triturado.jpeg"
            },
            {
                "id": 4,
                "name": "Hielo por Cubeta",
                "description": "Para bares y restaurantes.",
                "price": 120.0,
                "stock": 30,
                "image_url": "img/cubeta.jpeg"
            },
            {
                "id": 5,
                "name": "Hielo por Bloque",
                "description": "Máxima duración para enfriar grandes volúmenes.",
                "price": 180.0,
                "stock": 15,
                "image_url": "img/bloque.jpeg"
            }
        ]

        # Crear usuario de prueba con ID 1 si no existe
        if not User.query.get(1):
            test_user = User(
                id=1,
                username="usuario_prueba",
                email="test@hielito.com",
                password=generate_password_hash("password123")
            )
            db.session.add(test_user)

        for p_data in initial_products:
            if not Product.query.get(p_data["id"]):
                product = Product(**p_data)
                db.session.add(product)
        
        db.session.commit()
        print("Productos iniciales cargados con éxito.")

if __name__ == "__main__":
    seed_products()