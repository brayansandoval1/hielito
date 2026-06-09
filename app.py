from backend import create_app, db
import os

app = create_app()

@app.cli.command("init-db")
def init_db():
    db.create_all()
    print("Base de datos inicializada.")

if __name__ == '__main__':
    # Puerto 5001 para evitar conflictos en Mac
    port = int(os.environ.get("PORT", 5001))
    # En producción usamos host 0.0.0.0 y desactivamos debug
    app.run(host='0.0.0.0', port=port, debug=False)