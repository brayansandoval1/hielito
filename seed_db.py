from app import app, db
from backend.models import Product, User, Category
from werkzeug.security import generate_password_hash

def seed_products():
    with app.app_context():
        print("Reiniciando base de datos...")
        db.drop_all()
        db.create_all()

        # Crear usuario de prueba
        test_user = User(
            username="usuario_prueba",
            email="test@hielito.com",
            password=generate_password_hash("password123", method='pbkdf2:sha256')
        )
        db.session.add(test_user)

        # Definir Categorías y sus productos dinámicos
        data = [
            {
                "category": "HIELO EN BOLSA",
                "description": "Variedad de presentaciones para tu hogar o evento.",
                "image": "img/bolsa.jpeg",
                "items": [
                    {"name": "Bolsa 1/2 kg", "price": 25.0, "ideal": "Eventos pequeños"},
                    {"name": "Bolsa 1 kg", "price": 40.0, "ideal": "Eventos medianos"},
                    {"name": "Bolsa 2 kg", "price": 70.0, "ideal": "Eventos grandes"},
                    {"name": "Bolsa 3 kg", "price": 95.0, "ideal": "Eventos masivos"},
                    {"name": "Bolsa 5 kg", "price": 150.0, "ideal": "Eventos corporativos"}
                ]
            },
            {
                "category": "VASOS DE HIELO",
                "description": "Listos para servir en tus fiestas.",
                "image": "img/vaso.jpeg",
                "items": [
                    {"name": "10 vasos", "price": 80.0, "ideal": "Fiesta pequeña"},
                    {"name": "25 vasos", "price": 180.0, "ideal": "Fiesta mediana"},
                    {"name": "50 vasos", "price": 320.0, "ideal": "Fiesta grande"},
                    {"name": "100 vasos", "price": 550.0, "ideal": "Evento corporativo"}
                ]
            },
            {
                "category": "HIELO TRITURADO PARA RASPADO EN BOLSA",
                "description": "Textura perfecta para refrescar.",
                "image": "img/triturado.jpeg",
                "items": [
                    {"name": "1 kg", "price": 35.0, "ideal": "Raspados individuales"},
                    {"name": "5 kg", "price": 150.0, "ideal": "Puesto de raspados"},
                    {"name": "10 kg", "price": 280.0, "ideal": "Evento grande"},
                    {"name": "20 kg", "price": 500.0, "ideal": "Feria o festival"}
                ]
            },
            {
                "category": "HIELO POR CUBETA",
                "description": "Para bares y restaurantes.",
                "image": "img/cubeta.jpeg",
                "items": [
                    {"name": "1 cubeta", "price": 120.0, "ideal": "Bar pequeño"},
                    {"name": "3 cubetas", "price": 320.0, "ideal": "Restaurante"},
                    {"name": "5 cubetas", "price": 500.0, "ideal": "Bar grande"},
                    {"name": "10 cubetas", "price": 900.0, "ideal": "Hotel o evento"}
                ]
            }
        ]

        for cat_data in data:
            category = Category(
                name=cat_data["category"],
                description=cat_data["description"],
                image_url=cat_data["image"]
            )
            db.session.add(category)
            db.session.flush() # Para obtener el ID de la categoría y asignarlo a los productos

            for item in cat_data["items"]:
                product = Product(
                    name=item["name"],
                    price=item["price"],
                    ideal_for=item["ideal"],
                    category_id=category.id,
                    stock=100,
                    image_url=cat_data["image"]
                )
                db.session.add(product)
        
        db.session.commit()
        print("Base de datos recreada y productos iniciales cargados con éxito.")

if __name__ == "__main__":
    seed_products()