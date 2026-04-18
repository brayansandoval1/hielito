// Configuración básica
const API_URL = '/api';
// REEMPLAZA ESTO con tu Clave Pública de Stripe
const stripe = Stripe('pk_test_51TNfxTPYbgBc47qk5E2eNmouiW953bjDBM6JTgVEsWhPnzndfBKqo8GborKL5amj5lOiv1pSSrkWRsw9EK9RWgjk00e3can8Dd'); 
const elements = stripe.elements();

// Crear el estilo para el formulario de tarjeta
const card = elements.create('card', {
    style: {
        base: {
            fontSize: '16px',
            color: '#32325d',
        },
    },
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('Hielito Mexicano listo');

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

    const paymentButtons = document.querySelectorAll('.btn-pagar');
    paymentButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
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
                // 2. Enviar al Backend
                const result = await processPayment(productId, 1, paymentMethod.id);
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
    const response = await fetch(`${API_URL}/payments/process`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ product_id: productId, quantity, payment_method: paymentMethodId })
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