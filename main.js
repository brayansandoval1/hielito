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

// Inicializar el carrito desde localStorage
let cart = JSON.parse(localStorage.getItem('hielito_cart')) || [];

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
            localStorage.setItem('username', data.user.username);
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

    loadDynamicStore();
    loadPromotions();
    updateAuthUI();
    updateCartBadge();

    // Manejar Login Manual
    const formLogin = document.getElementById('form-login');
    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            try {
                const res = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();
                if (res.ok) {
                    localStorage.setItem('token', data.access_token);
                    localStorage.setItem('username', data.user.username);
                    location.reload();
                } else {
                    alert(data.error || "Error al iniciar sesión");
                }
            } catch (error) {
                alert("Error de conexión con el servidor");
            }
        });
    }

    // Manejar Registro Manual
    const formRegister = document.getElementById('form-register');
    if (formRegister) {
        formRegister.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('reg-username').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            try {
                const res = await fetch(`${API_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, email, password })
                });
                const data = await res.json();
                if (res.ok) {
                    alert("¡Cuenta creada exitosamente! Ya puedes iniciar sesión.");
                    const tabTrigger = new bootstrap.Tab(document.querySelector('button[data-bs-target="#tabLogin"]'));
                    tabTrigger.show();
                } else {
                    alert(data.error || "Error en el registro");
                }
            } catch (error) {
                alert("Error de conexión con el servidor");
            }
        });
    }

    // Gestionar eventos de Modales
    const modalPedidos = document.getElementById('modalPedidos');
    if (modalPedidos) modalPedidos.addEventListener('shown.bs.modal', loadOrders);

    const modalCart = document.getElementById('modalCart');
    if (modalCart) modalCart.addEventListener('shown.bs.offcanvas', renderCart);

    const modalCheckout = document.getElementById('modalCheckout');
    if (modalCheckout) {
        modalCheckout.addEventListener('shown.bs.modal', () => {
            if (card) card.mount('#stripe-card-element');
        });
        modalCheckout.addEventListener('hidden.bs.modal', () => {
            if (card) card.unmount();
        });
    }

    // Forzar renderizado del botón de Google al abrir el modal
    const modalAuth = document.getElementById('modalAuth');
    if (modalAuth) {
        modalAuth.addEventListener('shown.bs.modal', () => {
            if (window.google) {
                google.accounts.id.renderButton(
                    document.querySelector(".g_id_signin"),
                    { theme: "outline", size: "large", text: "signin_with", shape: "rectangular", logo_alignment: "left" }
                );
            }
        });
    }

    // Ir de carrito a checkout
    const btnToCheckout = document.getElementById('btn-to-checkout');
    if (btnToCheckout) {
        btnToCheckout.addEventListener('click', () => {
            if (cart.length === 0) return alert("Tu carrito está vacío.");
            bootstrap.Offcanvas.getInstance(document.getElementById('modalCart')).hide();
            new bootstrap.Modal(document.getElementById('modalCheckout')).show();
        });
    }

    // Confirmar Pago (Checkout Unificado)
    const btnConfirmPayment = document.getElementById('btn-confirm-payment');
    if (btnConfirmPayment) {
        btnConfirmPayment.addEventListener('click', async () => {
            const token = localStorage.getItem('token');
            if (!token || token === 'null') return alert("Inicia sesión para finalizar tu compra.");

            const { paymentMethod, error } = await stripe.createPaymentMethod({
                type: 'card',
                card: card,
            });

            if (error) {
                document.getElementById('stripe-errors').textContent = error.message;
                return;
            }

            const deliveryData = {
                phone: document.getElementById('check-phone').value,
                address: document.getElementById('check-address').value,
                delivery_date: document.getElementById('check-date').value,
                delivery_time: document.getElementById('check-time').value
            };

            const result = await processPayment(cart, paymentMethod.id, deliveryData);
            
            if (result.error) {
                alert("Error: " + result.error);
            } else {
                alert("¡Compra realizada con éxito! Estado: " + result.order.status);
                cart = [];
                saveCart();
                location.reload();
            }
        });
    }

    // Manejar clics en botones estáticos de "Añadir al Carrito"
    document.querySelectorAll('.btn-add-cart').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            const price = btn.getAttribute('data-price');
            window.addToCartFromModal(id, name, price);
        });
    });

    initCountdownTimers();
});

async function loadDynamicStore() {
    try {
        // Añadimos un timestamp para evitar que el navegador use una respuesta cacheada
        const res = await fetch(`${API_URL}/products/?t=${new Date().getTime()}`);
        
        if (!res.ok) {
            throw new Error(`Error del servidor: ${res.status}`);
        }

        const categories = await res.json();
        const container = document.getElementById('categories-container');
        
        container.innerHTML = categories.map(cat => `
            <div class="col-md-6 col-lg-3">
                <div class="product-card shadow-sm" style="cursor: pointer;" onclick="openCategory('${cat.id}')">
                    <div class="product-card-body">
                        <img src="${cat.image_url}" alt="${cat.name}" style="height: 300px; object-fit: contain;">
                        <h3 class="mt-3 text-uppercase">${cat.name}</h3>
                        <p class="product-desc small">${cat.description || ''}</p>
                        <button class="btn btn-outline-primary btn-sm rounded-pill">Ver Opciones</button>
                    </div>
                </div>
            </div>
        `).join('');

        // Guardar datos globalmente para acceso rápido del modal
        window.allCategories = categories;
    } catch (error) {
        console.error("Error cargando la tienda:", error);
    }
}

async function loadPromotions() {
    try {
        const res = await fetch(`${API_URL}/promotions/`);
        if (!res.ok) throw new Error("Error cargando promociones");
        const promos = await res.json();
        const container = document.getElementById('promotions-container');
        if (!container) return;

        if (promos.length === 0) {
            container.innerHTML = '<div class="col-12 text-center text-muted"><p>No hay promociones activas en este momento.</p></div>';
            return;
        }

        container.innerHTML = promos.map(promo => {
            const itemsHtml = promo.items.map(item => 
                `<li><strong>${item.quantity} ${item.product_name}</strong></li>`
            ).join('');

            return `
                <div class="col-lg-4">
                    <div class="promo-card shadow-sm h-100 border-0 overflow-hidden">
                        <div class="promo-header bg-${promo.color_scheme} ${promo.color_scheme === 'warning' ? 'text-dark' : 'text-white'} p-4">
                            <h3 class="mb-2 text-uppercase fs-5">${promo.header_title}</h3>
                            <p class="mb-0 small opacity-75">${promo.header_subtitle || ''}</p>
                        </div>
                        <div class="promo-body p-4 bg-white d-flex flex-column h-100">
                            <h4 class="promo-title fw-bold text-primary mb-3">${promo.promo_name}</h4>
                            <p class="promo-desc text-muted small mb-4">${promo.description || ''}</p>
                            <div class="promo-details mb-4">
                                <ul class="list-unstyled mb-0 border-start border-3 border-warning ps-3">
                                    ${itemsHtml}
                                    <li class="mt-2 text-muted text-decoration-line-through small">Precio regular: $${promo.original_price.toFixed(2)}</li>
                                    <li class="fs-5 text-success fw-bold">Precio promo: $${promo.promo_price.toFixed(2)}</li>
                                </ul>
                            </div>
                            <div class="promo-timer text-center bg-light rounded p-2 mt-auto">
                                <p class="small mb-1 fw-semibold text-uppercase" style="font-size: 0.7rem;">¡Termina en!</p>
                                <div class="countdown d-flex justify-content-center gap-1" data-end="${promo.expiration_date}">
                                    <div class="text-center"><span class="countdown-days d-block fw-bold">00</span><small class="text-uppercase" style="font-size: 0.5rem;">Días</small></div>
                                    <div class="fw-bold">:</div>
                                    <div class="text-center"><span class="countdown-hours d-block fw-bold">00</span><small class="text-uppercase" style="font-size: 0.5rem;">Hrs</small></div>
                                    <div class="fw-bold">:</div>
                                    <div class="text-center"><span class="countdown-minutes d-block fw-bold">00</span><small class="text-uppercase" style="font-size: 0.5rem;">Min</small></div>
                                    <div class="fw-bold">:</div>
                                    <div class="text-center"><span class="countdown-seconds d-block fw-bold">00</span><small class="text-uppercase" style="font-size: 0.5rem;">Seg</small></div>
                                </div>
                            </div>
                        </div>
                        <div class="promo-footer p-4 bg-light border-top">
                            <button class="btn btn-${promo.color_scheme} w-100 fw-bold py-2 shadow-sm" onclick="addPromotionToCart(${promo.id})">
                                COMPRAR AHORA <i class="bi bi-bag-check-fill ms-2"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
        }).join('');

        window.allPromotions = promos;
        initCountdownTimers();
    } catch (error) {
        console.error("Error cargando promociones:", error);
    }
}

window.addPromotionToCart = (id) => {
    const promo = window.allPromotions.find(p => p.id == id);
    if (!promo) return;

    const token = localStorage.getItem('token');
    if (!token) return alert("Por favor, inicia sesión para adquirir esta promoción.");

    let promoWeight = 0;
    promo.items.forEach(item => {
        promoWeight += parseWeight(item.product_name) * item.quantity;
    });

    const existingItem = cart.find(item => item.promo_id === id);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ 
            promo_id: id, 
            product_id: null, // Para que el backend sepa que es una promo
            name: `🎁 ${promo.promo_name}`, 
            price: promo.promo_price, 
            quantity: 1, 
            weight: promoWeight,
            is_promo: true 
        });
    }

    saveCart();
    renderCart();
    alert(`¡Promoción "${promo.promo_name}" añadida al carrito!`);
    
    const cartModalEl = document.getElementById('modalCart');
    bootstrap.Offcanvas.getOrCreateInstance(cartModalEl).show();
};

window.openCategory = (id) => {
    const cat = window.allCategories.find(c => c.id == id);
    document.getElementById('dynamic-modal-title').textContent = cat.name;
    document.getElementById('dynamic-modal-img').src = cat.image_url;
    document.getElementById('dynamic-modal-desc').textContent = cat.description;
    
    const table = document.getElementById('dynamic-products-table');
    table.innerHTML = cat.products.map(p => `
        <tr>
            <td><strong>${p.name}</strong></td>
            <td class="text-primary fw-bold">$${p.price.toFixed(2)}</td>
            <td><small class="text-muted">${p.ideal_for || '-'}</small></td>
            <td>
                <div class="d-flex gap-2 align-items-center justify-content-end">
                    <input type="number" id="qty-${p.id}" class="form-control form-control-sm" value="1" min="1" style="width: 60px;">
                    <button class="btn btn-sm btn-primary d-flex align-items-center" onclick="addToCartFromModal(${p.id}, '${p.name}', ${p.price})">
                        <i class="bi bi-cart-plus-fill me-1"></i> 
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    
    new bootstrap.Modal(document.getElementById('modalDynamicProducts')).show();
};

window.addToCartFromModal = (id, name, price) => {
    let qtyInput = document.getElementById(`qty-${id}`);

    // Si no encuentra el input por ID (para modales estáticos), lo busca en el modal activo
    if (!qtyInput) {
        const activeModal = document.querySelector('.modal.show');
        if (activeModal) qtyInput = activeModal.querySelector('input[type="number"]');
    }

    if (!qtyInput) return alert("No se pudo encontrar la cantidad seleccionada.");

    const qty = parseInt(qtyInput.value);

    const token = localStorage.getItem('token');
    if (!token) {
        alert("Por favor, inicia sesión para añadir productos al carrito.");
        return;
    }
    
    if (isNaN(qty) || qty < 1) return alert("Cantidad no válida");

    const existingItem = cart.find(item => item.product_id === id);
    if (existingItem) {
        existingItem.quantity += qty;
    } else {
        cart.push({ product_id: id, name, price, quantity: qty });
    }
    
    saveCart();
    renderCart();
    
    // 1. Mensaje de alerta personalizado
    alert(`¡Excelente elección! Has añadido ${qty} x ${name} a tu carrito.`);

    // 2. Cerrar el modal actual de productos
    const currentModalEl = document.querySelector('.modal.show');
    if (currentModalEl) {
        const modalInstance = bootstrap.Modal.getInstance(currentModalEl);
        if (modalInstance) modalInstance.hide();
    }

    // 3. Abrir automáticamente el modal del carrito
    const cartModalEl = document.getElementById('modalCart');
    const cartOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(cartModalEl, {
        scroll: true,
        backdrop: false
    });
    cartOffcanvas.show();
};

function saveCart() {
    localStorage.setItem('hielito_cart', JSON.stringify(cart));
    updateCartBadge();
}

function updateCartBadge() {
    const totalQty = cart.reduce((acc, item) => acc + item.quantity, 0);
    const badge = document.getElementById('cart-count');
    if (badge) badge.textContent = totalQty;
}

/**
 * Extrae el peso numérico de un nombre de producto
 * Ejemplo: "Bolsa 1/2 kg" -> 0.5, "1 cubeta" -> 20
 */
function parseWeight(name) {
    const lower = name.toLowerCase();
    if (lower.includes('1/2 kg')) return 0.5;
    if (lower.includes('cubeta')) return 20; // Las cubetas son de 20kg según descripción
    const match = lower.match(/(\d+)\s*kg/);
    return match ? parseFloat(match[1]) : 0;
}

function renderCart() {
    const container = document.getElementById('cart-items-container');
    const totalElement = document.getElementById('cart-total');
    const weightElement = document.getElementById('cart-weight');
    const deliveryInfo = document.getElementById('cart-delivery-info');
    
    if (cart.length === 0) {
        container.innerHTML = '<p class="text-center py-4">Tu carrito está vacío.</p>';
        totalElement.textContent = '$0.00';
        weightElement.textContent = '0.0 kg';
        // Si el carrito está vacío, ocultamos la alerta de entrega inmediatamente
        if (deliveryInfo) deliveryInfo.classList.add('d-none');
        return;
    }

    let total = 0;
    let totalWeight = 0;

    container.innerHTML = cart.map(item => {
        const subtotal = item.price * item.quantity;
        const itemWeight = (item.weight || parseWeight(item.name)) * item.quantity;
        
        total += subtotal;
        totalWeight += itemWeight;

        return `
            <div class="card mb-2 border-0 bg-white shadow-sm">
                <div class="card-body d-flex justify-content-between align-items-center py-2 px-3">
                    <div style="flex: 1;">
                        <h6 class="mb-0 fw-bold text-dark">${item.name}</h6>
                        <small class="text-muted">
                            ${item.quantity} unidad(es) x $${item.price.toFixed(2)}
                            ${itemWeight > 0 ? ` | <span class="text-info">${itemWeight.toFixed(1)} kg</span>` : ''}
                        </small>
                    </div>
                    <div class="text-end" style="min-width: 100px;">
                        <span class="fw-bold d-block">$${subtotal.toFixed(2)}</span>
                        <button class="btn btn-link btn-sm text-danger p-0" onclick="removeFromCart(${item.promo_id || item.product_id}, ${!!item.is_promo})" title="Eliminar">
                            <small>Eliminar</small>
                        </button>
                    </div>
                </div>
            </div>`;
    }).join('');

    totalElement.textContent = `$${total.toFixed(2)}`;
    weightElement.textContent = `${totalWeight.toFixed(1)} kg`;

    // Lógica de tiempo de entrega basada en el peso
    if (deliveryInfo) {
        if (totalWeight > 0) {
            deliveryInfo.classList.remove('d-none');
            if (totalWeight <= 20) {
                deliveryInfo.innerHTML = '⚡ <strong>Entrega hoy:</strong> Al ser un pedido ligero (hasta 20kg), ¡te lo entregamos hoy mismo!';
                deliveryInfo.className = 'alert alert-success py-2 small mb-2';
            } else {
                deliveryInfo.innerHTML = '🚚 <strong>Entrega en 48h:</strong> Por el volumen de carga (>20kg), la entrega se programará para dentro de 2 días.';
                deliveryInfo.className = 'alert alert-info py-2 small mb-2';
            }
        } else {
            deliveryInfo.classList.add('d-none');
        }
    }
}

window.removeFromCart = (id, isPromo) => {
    if (isPromo) {
        cart = cart.filter(item => item.promo_id !== id);
    } else {
        cart = cart.filter(item => item.product_id !== id);
    }
    saveCart();
    renderCart();
};

function updateAuthUI() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    const authNavItem = document.getElementById('auth-nav-item');
    const cartNavItem = document.getElementById('cart-nav-item');
    
    if (token && authNavItem) {
        if (cartNavItem) cartNavItem.classList.remove('d-none');
        authNavItem.innerHTML = `
            <div class="d-flex align-items-center">
                <span class="navbar-text me-3 fw-bold" style="color: var(--azul-fuerte-textos);">Hola, ${username}</span>
                <button class="btn btn-sm btn-outline-danger" id="btnLogout">Cerrar Sesión</button>
            </div>
        `;
        document.getElementById('btnLogout').addEventListener('click', () => {
            localStorage.removeItem('token');
            localStorage.removeItem('username');
            localStorage.removeItem('hielito_cart');
            cart = [];
            location.reload();
        });
    } else {
        if (cartNavItem) cartNavItem.classList.add('d-none');
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

        tbody.innerHTML = orders.map(o => `
            <tr>
                <td>#${o.id} <br><span class="badge bg-info" style="font-size: 0.7rem;">${o.status}</span></td>
                <td><small>${o.items.map(i => i.product_name).join(', ')}</small></td>
                <td>${new Date(o.created_at).toLocaleDateString()}</td>
                <td>${o.items.reduce((acc, item) => acc + item.quantity, 0)}</td>
                <td class="fw-bold">$${o.total.toFixed(2)}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="text-center">No hay pedidos.</td></tr>';
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Error al cargar pedidos. Asegúrate de estar logueado.</td></tr>';
    }
}

async function processPayment(items, paymentMethodId, deliveryData) {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/payments/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
            items: items.map(i => ({ 
                product_id: i.product_id || null, 
                promo_id: i.promo_id || null,
                quantity: i.quantity 
            })),
            payment_method: paymentMethodId,
            ...deliveryData
        })
    });
    return await response.json();
}

// Función para inicializar los contadores de las promociones
function initCountdownTimers() {
    const countdownElements = document.querySelectorAll('.countdown');
    
    countdownElements.forEach(element => {
        const endDate = element.getAttribute('data-end');
        
        // Reemplazamos el espacio por 'T' para asegurar compatibilidad ISO con todos los navegadores
        // Esto es vital para que las fechas de SQLite (YYYY-MM-DD HH:MM:SS) se procesen bien
        const dateString = endDate.includes('T') ? endDate : endDate.replace(' ', 'T');
        const endDateTime = new Date(dateString).getTime();
        
        const updateCountdown = () => {
            const now = new Date().getTime();
            const distance = endDateTime - now;
            
            if (distance > 0) {
                const days = Math.floor(distance / (1000 * 60 * 60 * 24));
                const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((distance % (1000 * 60)) / 1000);
                
                element.querySelector('.countdown-days').textContent = String(days).padStart(2, '0');
                element.querySelector('.countdown-hours').textContent = String(hours).padStart(2, '0');
                element.querySelector('.countdown-minutes').textContent = String(minutes).padStart(2, '0');
                element.querySelector('.countdown-seconds').textContent = String(seconds).padStart(2, '0');
            } else {
                element.innerHTML = '<span class="text-danger">¡TERMINADO!</span>';
            }
        };
        
        updateCountdown();
        setInterval(updateCountdown, 1000);
    });
}