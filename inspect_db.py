from app import app
from backend.models import User, Order, Product

def show_summary():
    with app.app_context():
        print("\n=== RESUMEN DE BASE DE DATOS ===")
        
        print(f"\nUSUARIOS REGISTRADOS ({User.query.count()}):")
        for u in User.query.all():
            print(f" - {u.username} [{u.email}]")

        print(f"\nPRODUCTOS EN STOCK:")
        for p in Product.query.all():
            print(f" - {p.name}: {p.stock} unidades")

        print(f"\nÚLTIMOS PEDIDOS ({Order.query.count()}):")
        for o in Order.query.order_by(Order.created_at.desc()).limit(5).all():
            print(f" - Pedido #{o.id}: {o.product_name} x{o.quantity} - Total: ${o.total}")

if __name__ == "__main__":
    show_summary()