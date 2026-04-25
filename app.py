from backend import create_app, db
from backend.models import Product
from sqlalchemy import text

app = create_app()

@app.cli.command("init-db")
def init_db():
    db.create_all()
    print("Base de datos inicializada.")

if __name__ == '__main__':
    # IMPORTANTE: Desactivar threading para SQLite
    app.run(debug=True, threaded=False)