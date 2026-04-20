// Configuración básica
const API_URL = '/api';
// REEMPLAZA ESTO con tu Clave Pública de Stripe
const stripe = Stripe('pk_test_51TNfxTPYbgBc47qk5E2eNmouiW953bjDBM6JTgVEsWhPnzndfBKqo8GborKL5amj5lOiv1pSSrkWRsw9EK9RWgjk00e3can8Dd'); 

let elements, card;
if (typeof stripe !== 'undefined') {
    elements = stripe.elements();
    card = elements.create('card', {
        style: {
            base: { fontSize: '16px', color: '#32325d' },
        },
    });
}

// Definir handleGoogleSignIn globalmente fuera del DOMContentLoaded
window.handleGoogleSignIn = async (response) => {
    const id_token = response.credential;
    try {
        console.log("Iniciando sesión con Google...");
        const res = await fetch(`${API_URL}/auth/google-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: id_token })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('token', data.access_token);
            location.reload();
        } else {
            alert("Error con Google Login: " + (data.error || "Algo salió mal."));
        }
    } catch (error) {
        console.error("Error de red en Google Login:", error);
        alert("No se pudo conectar con el servidor para el inicio de sesión con Google.");
    }
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('Hielito Mexicano listo');

    // Verificar si hay una sesión activa
    updateAuthUI();

    // Detectar cuando se abre cualquier modal de Bootstrap
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (modal.id === 'modalPedidos') {
            modal.addEventListener('shown.bs.modal', loadOrders);
        }

        modal.addEventListener('shown.bs.modal', () => {
            const cardContainer = modal.querySelector('[id^="card-element-"]');
            if (cardContainer) {
                card.mount(cardContainer);
            }
        });

        // Desmontar el elemento al cerrar el modal para que pueda ser re-usado
        modal.addEventListener('hidden.bs.modal', () => {
            card.unmount();
            const errorElement = modal.querySelector('[id^="card-errors"]');
            if (errorElement) errorElement.textContent = '';
        });
    });

    // Manejar el envío del formulario de Login
    const loginForm = document.getElementById('form-login');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Enviando formulario de login...');
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            try {
                const response = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await response.json();
                if (response.ok) {
                    localStorage.setItem('token', data.access_token);
                    location.reload();
                } else {
                    alert("Error: " + data.error);
                }
            } catch (error) {
                console.error("Error de red en Login:", error);
                alert("Error de conexión con el servidor.");
            }
        });
    }

    // Manejar el envío del formulario de Registro
    const registerForm = document.getElementById('form-register');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('reg-username').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            const response = await fetch(`${API_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            const data = await response.json();
            alert(data.message || data.error);
        });
    }

    const paymentButtons = document.querySelectorAll('.btn-pagar');
    paymentButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            const token = localStorage.getItem('token');
            if (!token || token === 'null' || token === 'undefined') {
                alert("Por favor, inicia sesión para poder realizar una compra.");
                const modalAuth = new bootstrap.Modal(document.getElementById('modalAuth'));
                bootstrap.Modal.getInstance(e.target.closest('.modal')).hide();
                modalAuth.show();
                return;
            }

            const productId = e.target.getAttribute('data-product-id');
            
            // 1. Crear el Payment Method con Stripe
            const { paymentMethod, error } = await stripe.createPaymentMethod({
                type: 'card',
                card: card,
            });

            // Buscamos el div de error específico del modal que está abierto
            const modal = e.target.closest('.modal');
            const errorElement = modal.querySelector('[id^="card-errors"]');

            if (error) {
                if (errorElement) errorElement.textContent = error.message;
            } else {
                // 2. Obtener la cantidad real del input del modal actual
                const quantityInput = modal.querySelector('input[type="number"]');
                const quantity = quantityInput ? parseInt(quantityInput.value) : 1;
                
                const result = await processPayment(productId, quantity, paymentMethod.id);
                if (result.error) {
                    alert("Error en el pago: " + result.error);
                } else {
                    alert("¡Gracias por tu compra! Orden: " + result.order.id);
                    window.location.reload();
                }
            }
        });
    });
});

function updateAuthUI() {
    const token = localStorage.getItem('token');
    const authNavItem = document.getElementById('auth-nav-item');
    if (token && authNavItem) {
        authNavItem.innerHTML = `<button class="btn btn-danger ms-lg-3" id="btnLogout">Cerrar Sesión</button>`;
        document.getElementById('btnLogout').addEventListener('click', () => {
            localStorage.removeItem('token');
            location.reload();
        });
    }
}

async function fetchProducts() {
    try {
        const response = await fetch(`${API_URL}/products/`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error cargando productos:', error);
    }
}

async function loadOrders() {
    const tbody = document.getElementById('tabla-pedidos-body');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Cargando pedidos...</td></tr>';

    const token = localStorage.getItem('token');
    if (!token || token === 'null' || token === 'undefined') {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-warning">Inicia sesión para ver tu historial.</td></tr>';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/orders/`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const orders = await response.json();
        
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">No tienes pedidos aún.</td></tr>';
            return;
        }

        tbody.innerHTML = orders.map(order => `
            <tr>
                <td>#${order.id}</td>
                <td>${new Date(order.created_at).toLocaleDateString()}</td>
                <td>${order.quantity} unidades</td>
                <td>$${order.total.toFixed(2)} MXN</td>
            </tr>
        `).join('');
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Error al cargar pedidos. Asegúrate de estar logueado.</td></tr>';
    }
}

async function processPayment(productId, quantity, paymentMethodId) {
    const token = localStorage.getItem('token'); // Asumiendo que guardas el JWT
    if (!token || token === 'null' || token === 'undefined') {
        return { error: 'No se encontró una sesión activa. Por favor reingresa.' };
    }

    const response = await fetch(`${API_URL}/payments/process`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
            product_id: parseInt(productId), 
            quantity: parseInt(quantity), 
            payment_method: paymentMethodId 
        })
    });
    
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await response.json();
        if (!response.ok) return { error: data.error || 'Error en el servidor' };
        return data;
    } else {
        // Si el servidor responde con HTML (error 500), capturamos el texto
        const textError = await response.text();
        console.error("Error del servidor (no JSON):", textError);
        return { error: "El servidor respondió con un error inesperado (500)." };
    }
}