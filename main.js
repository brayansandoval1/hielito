// Configuración básica
const API_URL = '/api';
// REEMPLAZA ESTO con tu Clave Pública de Stripe
const stripe = (window.Stripe) ? Stripe('pk_test_51TNfxTPYbgBc47qk5E2eNmouiW953bjDBM6JTgVEsWhPnzndfBKqo8GborKL5amj5lOiv1pSSrkWRsw9EK9RWgjk00e3can8Dd') : null; 

let elements, card;
if (stripe) {
    elements = stripe.elements();
    card = elements.create('card', { 
        style: {
            base: { fontSize: '16px', color: '#32325d' },
        },
    });
}

// Inicializar el carrito desde localStorage
let cart = JSON.parse(localStorage.getItem('hielito_cart')) || [];

// Variables para paginación de pedidos del usuario
let allUserOrders = [];
let ordersCurrentPage = 1;
const ordersPerPage = 10;
let isIceAvailable = true;
let isLoyaltyActive = true;
let loyaltyThreshold = 50;
let deliveryThreshold = 20;
let whatsappPhone = "527352282129";

// --- Configuración de Seguridad de Sesión ---
let sessionTimeout;
const INACTIVITY_LIMIT = 30 * 60 * 1000; // 30 minutos de inactividad
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 horas de vida máxima del token

function logoutUser() {
    console.log("Sesión finalizada por seguridad/inactividad.");
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('hielito_cart');
    localStorage.removeItem('session_start');
    location.reload();
}

function resetInactivityTimer() {
    if (!localStorage.getItem('token')) return;
    
    clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(() => {
        alert("Tu sesión ha expirado por inactividad. Por favor, ingresa de nuevo.");
        logoutUser();
    }, INACTIVITY_LIMIT);
}
// --------------------------------------------

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
            localStorage.setItem('session_start', Date.now());
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

    // Verificar si la sesión ya cumplió su tiempo de vida máximo al cargar
    if (localStorage.getItem('token')) {
        const sessionStart = localStorage.getItem('session_start');
        if (sessionStart && (Date.now() - sessionStart > SESSION_MAX_AGE)) {
            logoutUser();
        } else {
            // Iniciar detección de inactividad
            resetInactivityTimer();
            ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll'].forEach(evt => {
                window.addEventListener(evt, resetInactivityTimer);
            });
        }
    }

    loadDynamicStore();
    loadPromotions();
    updateAuthUI();
    updateCartBadge();
    checkGlobalAvailability();

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
                    localStorage.setItem('session_start', Date.now());
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

    const modalAdmin = document.getElementById('modalAdminOrders');
    if (modalAdmin) modalAdmin.addEventListener('shown.bs.modal', loadAdminOrders);

    const switchIce = document.getElementById('switch-ice-availability');
    if (switchIce) {
        switchIce.addEventListener('change', (e) => toggleIceAvailability(e.target.checked));
    }

    const switchLoyalty = document.getElementById('switch-loyalty-active');
    if (switchLoyalty) {
        switchLoyalty.addEventListener('change', (e) => toggleLoyaltyAvailability(e.target.checked));
    }

    const modalCart = document.getElementById('modalCart');
    if (modalCart) modalCart.addEventListener('shown.bs.offcanvas', renderCart);

    const modalCheckout = document.getElementById('modalCheckout');
    if (modalCheckout) {
        modalCheckout.addEventListener('shown.bs.modal', () => {
            if (card) card.mount('#stripe-card-element');
            
            // Cargar datos de entrega guardados anteriormente
            const savedData = JSON.parse(localStorage.getItem('hielito_delivery_data'));
            if (savedData) {
                if (savedData.phone) document.getElementById('check-phone').value = savedData.phone;
                if (savedData.cp) document.getElementById('check-cp').value = savedData.cp;
                if (savedData.address) document.getElementById('check-address').value = savedData.address;
            }
        });
        modalCheckout.addEventListener('hidden.bs.modal', () => {
            if (card) card.unmount();
        });
    }

    // Manejar formularios de catálogo
    const formCat = document.getElementById('form-admin-category');
    if (formCat) {
        formCat.addEventListener('submit', (e) => {
            e.preventDefault();
            saveCategory();
        });
    }

    const formProd = document.getElementById('form-admin-product');
    if (formProd) {
        formProd.addEventListener('submit', (e) => {
            e.preventDefault();
            saveProduct();
        });
    }

    const formPromo = document.getElementById('form-admin-promotion');
    if (formPromo) {
        formPromo.addEventListener('submit', (e) => {
            e.preventDefault();
            savePromotion();
        });
    }

    // Escuchar cambios en los precios de la promo para calcular ahorro
    const priceFinal = document.getElementById('promo-price-final');
    if (priceFinal) {
        priceFinal.addEventListener('input', updateSavingsPercentage);
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
            if (!isIceAvailable) {
                alert("Lo sentimos, no hay hielo disponible por el momento. Por favor contacta por WhatsApp.");
                return;
            }
            if (cart.length === 0) return alert("Tu carrito está vacío.");

            // Calcular peso para mostrar mensaje de entrega en checkout
            const totalWeight = cart.reduce((acc, item) => acc + ((item.weight || parseWeight(item.name)) * item.quantity), 0);
            const checkoutMsg = document.getElementById('checkout-delivery-msg');
            
            if (checkoutMsg) {
                const estimate = getDeliveryEstimate(totalWeight);
                checkoutMsg.innerHTML = `<h6 class="alert-heading fw-bold mb-1">${estimate.title}</h6><p class="mb-0 small">${estimate.text}</p>`;
                checkoutMsg.className = `alert ${estimate.class} py-3 mb-4 shadow-sm border-0`;
            }

            // Usamos getOrCreateInstance para asegurar que Bootstrap encuentre el componente
            const cartModal = bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('modalCart'));
            const checkoutModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalCheckout'));
            
            cartModal.hide();
            checkoutModal.show();
        });
    }

    // Pedir por WhatsApp (Checkout Unificado)
    const btnOrderWhatsapp = document.getElementById('btn-order-whatsapp');
    if (btnOrderWhatsapp) {
        btnOrderWhatsapp.addEventListener('click', async () => {
            if (!isIceAvailable) {
                alert("Operación cancelada: No hay disponibilidad de producto.");
                return;
            }
            const token = localStorage.getItem('token');
            if (!token || token === 'null') return alert("Inicia sesión para finalizar tu compra.");

            const deliveryData = {
                phone: document.getElementById('check-phone').value,
                address: document.getElementById('check-address').value,
                cp: document.getElementById('check-cp').value
            };

            if (!deliveryData.phone || !deliveryData.address || !deliveryData.cp) {
                return alert("Por favor, completa todos los campos de entrega.");
            }

            // Guardar historial del formulario para futuras compras
            localStorage.setItem('hielito_delivery_data', JSON.stringify(deliveryData));

            const result = await processPayment(cart, 'whatsapp', deliveryData);
            
            if (result.error) {
                alert("Error: " + result.error);
            } else {
                // Generar mensaje estructurado para WhatsApp
                const total = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
                const username = localStorage.getItem('username') || 'Cliente';
                
                const whatsappMsg = `¡Hola! 👋 Vengo de la tienda en línea Hielito Mexicano.\n\n` +
                    `*NUEVO PEDIDO #${result.order.id}*\n` +
                    `👤 *Cliente:* ${username}\n` +
                    `📞 *Tel:* ${deliveryData.phone}\n` +
                    `📍 *Dirección:* ${deliveryData.address}\n` +
                    `📮 *CP:* ${deliveryData.cp}\n\n` +
                    `📦 *Productos:*\n` +
                    cart.map(item => {
                        let line = `  - ${item.quantity}x ${item.name} ($${(item.price * item.quantity).toFixed(2)})`;
                        if (item.is_promo && item.items) {
                            item.items.forEach(sub => {
                                line += `\n      • ${sub.quantity * item.quantity}x ${sub.product_name}`;
                            });
                        }
                        return line;
                    }).join('\n') +
                    `\n\n💰 *Total a pagar:* $${total.toFixed(2)}\n\n` +
                    `Espero su confirmación para el envío. ¡Gracias! ❄️`;
                
                const waUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(whatsappMsg)}`;
                
                alert("¡Pedido registrado con éxito! Te redirigiremos a WhatsApp para finalizar la comunicación con el repartidor.");
                
                cart = [];
                saveCart();
                window.location.href = waUrl; // Redirección directa más confiable
            }
        });
    }

    // Confirmar Pago (Checkout Unificado)
    const btnConfirmPayment = document.getElementById('btn-confirm-payment');
    if (btnConfirmPayment) {
        btnConfirmPayment.addEventListener('click', async () => {
            if (!isIceAvailable) {
                alert("Operación cancelada: No hay disponibilidad de producto.");
                return;
            }
            const token = localStorage.getItem('token');
            if (!token || token === 'null') return alert("Inicia sesión para finalizar tu compra.");

            // Deshabilitar botón y mostrar estado de procesamiento
            btnConfirmPayment.disabled = true;
            const originalText = btnConfirmPayment.innerHTML;
            btnConfirmPayment.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> PROCESANDO PAGO...`;

            const { paymentMethod, error } = await stripe.createPaymentMethod({
                type: 'card',
                card: card,
            });

            if (error) {
                document.getElementById('stripe-errors').textContent = error.message;
                // Re-habilitar botón en caso de error
                btnConfirmPayment.disabled = false;
                btnConfirmPayment.innerHTML = originalText;
                return;
            }

            const deliveryData = {
                phone: document.getElementById('check-phone').value,
                address: document.getElementById('check-address').value,
                cp: document.getElementById('check-cp').value
            };

            // Guardar historial del formulario para futuras compras
            localStorage.setItem('hielito_delivery_data', JSON.stringify(deliveryData));

            try {
                const result = await processPayment(cart, paymentMethod.id, deliveryData);
                
                if (result.error) {
                    alert("Error: " + result.error);
                    btnConfirmPayment.disabled = false;
                    btnConfirmPayment.innerHTML = originalText;
                } else {
                    // Mostrar éxito en el botón antes de recargar
                    btnConfirmPayment.classList.replace('btn-primary', 'btn-success');
                    btnConfirmPayment.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i> ¡PAGO PROCESADO CON ÉXITO!`;
                    
                    setTimeout(() => {
                        alert("¡Compra realizada con éxito! Tu pedido está en camino.");
                        cart = [];
                        saveCart();
                        location.reload();
                    }, 2000);
                }
            } catch (err) {
                alert("Error de conexión al procesar el pago.");
                btnConfirmPayment.disabled = false;
                btnConfirmPayment.innerHTML = originalText;
            }
        });
    }

    // Manejar clics en botones estáticos de "Añadir al Carrito"
    document.querySelectorAll('.btn-add-cart').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            const price = btn.getAttribute('data-price');
            const weight = btn.getAttribute('data-weight') || 0;
            window.addToCartFromModal(id, name, price, parseFloat(weight));
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
        
        // Solo mostrar categorías ACTIVAS que tengan al menos un producto ACTIVO
        const activeCategories = categories.filter(cat => cat.is_active);

        container.innerHTML = activeCategories.map(cat => `
            <div class="col-md-6 col-lg-3">
                <div class="product-card shadow-sm" style="cursor: pointer;" onclick="openCategory('${cat.id}')">
                    <div class="product-card-body">
                        <img src="${cat.image_url}" alt="${cat.name}" style="height: 300px; object-fit: contain;">
                        <h3 class="mt-3 text-uppercase">${cat.name}</h3>
                        <p class="product-desc small text-muted">${cat.description || ''}</p>
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
        console.log("Contenedor promociones encontrado:", container);
        console.log("Promociones recibidas del servidor:", promos.length);
        if (!container) return;

        if (promos.length === 0) {
            container.innerHTML = '<div class="col-12 text-center text-muted"><p>No hay promociones activas en este momento.</p></div>';
            return;
        }

        container.innerHTML = promos.map(promo => {
            const itemsHtml = promo.items.map(item => 
                `<li class="mb-1"><i class="bi bi-dot"></i> <strong>${item.quantity}x</strong> ${item.product_name}</li>`
            ).join('');

            const ahorro = Math.round((1 - promo.promo_price / promo.original_price) * 100);

            return `
                <div class="col-lg-4">
                    <div class="promo-card shadow-sm h-100 border-0 overflow-hidden" style="min-height: 580px; max-height: 580px;">
                        <!-- 1. TITULO PRINCIPAL (MAYOR CONTRASTE) -->
                        <div class="bg-${promo.color_scheme} ${promo.color_scheme === 'warning' ? 'text-dark' : 'text-white'} p-3 text-center">
                            <span class="badge bg-light text-dark mb-2 px-3 py-2 fw-bold text-uppercase">${promo.header_title}</span>
                            <h3 class="mb-1 fs-4 fw-bold">${promo.promo_name}</h3>
                            ${promo.header_subtitle ? `<p class="mb-0 small opacity-80">${promo.header_subtitle}</p>` : ''}
                        </div>
                        
                        <div class="promo-body p-4 bg-white d-flex flex-column h-100">
                            <!-- 2. DESCRIPCION -->
                            <p class="promo-desc mb-3 fs-6">${promo.description || ''}</p>
                            
                            <!-- 3. CONTENIDO DEL PAQUETE -->
                            <div class="border rounded p-3 mb-3 bg-light">
                                <h6 class="fw-bold text-primary mb-2">📦 Incluye:</h6>
                                <ul class="list-unstyled mb-0 small">
                                    ${itemsHtml}
                                </ul>
                            </div>
                            
                            <!-- 4. PRECIOS Y AHORRO -->
                            <div class="border rounded p-3 mb-3">
                                <div class="d-flex justify-content-between align-items-center">
                                    <div>
                                        <span class="text-muted text-decoration-line-through">${promo.original_price.toFixed(2)}</span>
                                        <h4 class="mb-0 fw-bold text-success">${promo.promo_price.toFixed(2)}</h4>
                                    </div>
                                    <div class="text-end">
                                        <span class="badge bg-success fs-6">-${ahorro}%</span>
                                        <p class="mb-0 small text-muted">AHORRO</p>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- 5. BOTON ACCION SUBIDO ARRIBA -->
                            <button class="btn btn-${promo.color_scheme} w-100 fw-bold py-3 shadow-sm mb-2" onclick="addPromotionToCart(${promo.id})">
                                🛒 ADQUIRIR PROMOCIÓN
                            </button>

                            <!-- 6. CRONOMETRO PEGADO INMEDIATAMENTE ABAJO -->
                            <div class="text-center bg-light rounded p-1 mt-0">
                                <p class="small mb-1 text-uppercase text-muted" style="font-size: 0.7rem;">⏰ Termina en:</p>
                                <div class="countdown d-flex justify-content-center gap-2" data-end="${promo.expiration_date}">
                                    <span class="countdown-days fw-bold text-dark fs-5">00</span><small class="text-uppercase text-muted pt-1">d</small>
                                    <span class="countdown-hours fw-bold text-dark fs-5">00</span><small class="text-uppercase text-muted pt-1">h</small>
                                    <span class="countdown-minutes fw-bold text-dark fs-5">00</span><small class="text-uppercase text-muted pt-1">m</small>
                                    <span class="countdown-seconds fw-bold text-dark fs-5">00</span><small class="text-uppercase text-muted pt-1">s</small>
                                </div>
                            </div>
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
    // ✅ VALIDACION COMPLETA ANTES DE HACER NADA
    const promo = window.allPromotions ? window.allPromotions.find(p => p.id == id) : null;
    
    if (!promo) {
        console.error("Promocion no encontrada ID:", id);
        return alert("Error: Promoción no valida o ya expiró. Actualiza la pagina.");
    }

    const token = localStorage.getItem('token');
    if (!token) return alert("Por favor, inicia sesión para adquirir esta promoción.");

    // ✅ Calcular peso EXACTO desde los items
    let promoWeight = 0;
    if(promo.items && promo.items.length > 0) {
        promo.items.forEach(item => {
            promoWeight += parseWeight(item.product_name) * item.quantity;
        });
    }

    // ✅ VALIDAR QUE EXISTA EN EL CARRITO CORRECTAMENTE
    const existingItemIndex = cart.findIndex(item => item.promo_id === id && item.is_promo === true);
    
    if (existingItemIndex !== -1) {
        // ✅ SI EXISTE: SOLO ACTUALIZAR CANTIDAD NUNCA MODIFICAR OTROS CAMPOS
        cart[existingItemIndex].quantity += 1;
    } else {
        // ✅ SI NO EXISTE: AGREGAR CON TODOS LOS CAMPOS COMPLETOS Y VALIDOS
        cart.push({ 
            promo_id: parseInt(id),
            product_id: null,
            name: `🎁 ${promo.promo_name.trim()}`,
            price: parseFloat(promo.promo_price),
            original_price: parseFloat(promo.original_price),
            quantity: 1,
            weight: parseFloat(promoWeight),
            is_promo: true,
            items: [...promo.items], // ✅ GUARDAR TAMBIEN LOS ITEMS INDIVIDUALES
            promo_expiration: promo.expiration_date
        });
    }

    // ✅ GUARDAR Y RENDERIZAR
    saveCart();
    renderCart();
    
    alert(`✅ Promoción añadida: ${promo.promo_name}\n\nTotal items en carrito: ${cart.reduce((a,i) => a+i.quantity, 0)}`);
    
    // ✅ ABRIR CARRITO
    setTimeout(() => {
        const cartModalEl = document.getElementById('modalCart');
        bootstrap.Offcanvas.getOrCreateInstance(cartModalEl).show();
    }, 200);
};

window.openCategory = (id) => {
    const cat = window.allCategories.find(c => c.id == id);
    document.getElementById('dynamic-modal-title').textContent = cat.name;
    document.getElementById('dynamic-modal-img').src = cat.image_url;
    document.getElementById('dynamic-modal-desc').textContent = cat.description;
    
    // Solo mostrar productos ACTIVOS dentro de la categoría
    const activeProducts = cat.products.filter(p => p.is_active);

    const table = document.getElementById('dynamic-products-table');
    table.innerHTML = activeProducts.map(p => `
        <tr>
            <td><strong>${p.name}</strong></td>
            <td class="text-primary fw-bold">$${p.price.toFixed(2)}</td>
            <td><small class="text-muted">${p.ideal_for || '-'}</small></td>
            <td>
                <div class="d-flex gap-2 align-items-center justify-content-end">
                    <input type="number" id="qty-${p.id}" class="form-control form-control-sm" value="1" min="1" style="width: 60px;">
                    <button class="btn btn-sm btn-primary d-flex align-items-center" onclick="addToCartFromModal(${p.id}, '${p.name}', ${p.price}, ${p.weight})">
                        <i class="bi bi-cart-plus-fill me-1"></i> 
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    
    new bootstrap.Modal(document.getElementById('modalDynamicProducts')).show();
};

window.addToCartFromModal = (id, name, price, weight = 0) => {
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
        cart.push({ product_id: id, name, price, quantity: qty, weight: weight });
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

/**
 * Calcula el compromiso de entrega basado en el peso
 */
function getDeliveryEstimate(weight) {
    if (weight <= deliveryThreshold) {
        return {
            title: "⚡ ¡Entrega hoy mismo!",
            text: `Tu pedido es ligero (hasta ${deliveryThreshold}kg), por lo que lo recibirás en el transcurso de las próximas horas.`,
            class: "alert-success"
        };
    } else {
        return {
            title: "🚚 Entrega programada en 48h",
            text: `Debido al volumen de carga (más de ${deliveryThreshold}kg), procesaremos tu envío con transporte especial en un lapso de 48 horas.`,
            class: "alert-info"
        };
    }
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
        if (!isIceAvailable) {
            deliveryInfo.classList.remove('d-none');
            deliveryInfo.innerHTML = `<strong>⚠️ HIELO NO DISPONIBLE</strong><br>Por el momento no podemos procesar pedidos. Por favor, contáctanos por WhatsApp para consultar el próximo surtido.`;
            deliveryInfo.className = 'alert alert-danger py-2 small mb-2';
            if (document.getElementById('btn-to-checkout')) document.getElementById('btn-to-checkout').disabled = true;
        } else {
            if (document.getElementById('btn-to-checkout')) document.getElementById('btn-to-checkout').disabled = false;
            if (totalWeight > 0) {
                const estimate = getDeliveryEstimate(totalWeight);
                deliveryInfo.classList.remove('d-none');
                deliveryInfo.innerHTML = `<strong>${estimate.title}</strong><br>${estimate.text}`;
                deliveryInfo.className = `alert ${estimate.class} py-2 small mb-2`;
            } else {
                deliveryInfo.classList.add('d-none');
            }
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
    const adminNavItem = document.getElementById('admin-nav-item');
    const cartNavItem = document.getElementById('cart-nav-item');
    
    if (token && authNavItem) {
        if (cartNavItem) cartNavItem.classList.remove('d-none');
        // Mostrar panel admin solo si es el usuario de prueba (puedes cambiar esta lógica después)
        if (adminNavItem && username === 'usuario_prueba') adminNavItem.classList.remove('d-none');
        
        authNavItem.innerHTML = `
            <div class="user-greeting-box">
                <span class="small fw-bold text-primary"><i class="bi bi-person-check-fill me-1"></i> ${username}</span>
                <button class="btn btn-sm btn-link text-danger text-decoration-none p-0 fw-bold" id="btnLogout" style="font-size: 0.8rem;">Cerrar Sesión</button>
            </div>
        `;
        document.getElementById('btnLogout').addEventListener('click', logoutUser);
    } else {
        if (cartNavItem) cartNavItem.classList.add('d-none');
        if (adminNavItem) adminNavItem.classList.add('d-none');
    }
}

async function loadOrders() {
    const tbody = document.getElementById('tabla-pedidos-body');
    const pagContainer = document.getElementById('pagination-pedidos');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5"><div class="spinner-border text-primary spinner-border-sm"></div> Cargando tu historial...</td></tr>';
    if (pagContainer) pagContainer.innerHTML = '';

    const token = localStorage.getItem('token');
    if (!token || token === 'null' || token === 'undefined') {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5 text-warning">Inicia sesión para ver tu historial de pedidos.</td></tr>';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/orders/?t=${new Date().getTime()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!response.ok) {
            console.error("Error fetching user orders:", data.error || data.msg || "Unknown error");
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-5 text-danger">Error al cargar pedidos: ${data.error || data.msg || "Acceso denegado o sesión expirada."}</td></tr>`;
            return;
        }

        allUserOrders = data.orders;
        const accWeight = data.accumulated_weight;
        isLoyaltyActive = data.loyalty_active;
        
        // Mostrar programa de lealtad
        const loyaltyContainer = document.getElementById('loyalty-container');
        if (loyaltyContainer) {
            if (!isLoyaltyActive) {
                loyaltyContainer.classList.add('d-none');
            } else {
                loyaltyContainer.classList.remove('d-none', 'border-warning');
                document.getElementById('loyalty-current').textContent = `${accWeight} kg`;
                document.getElementById('loyalty-target').textContent = `Meta: ${loyaltyThreshold} kg`;
                
                const percent = Math.min((accWeight / loyaltyThreshold) * 100, 100);
                document.getElementById('loyalty-progress-bar').style.width = `${percent}%`;
                document.getElementById('loyalty-progress-bar').className = percent >= 100 ? 'progress-bar bg-warning progress-bar-striped progress-bar-animated' : 'progress-bar bg-info';
                
                const msg = document.getElementById('loyalty-msg');
                if (percent >= 100) {
                    const username = localStorage.getItem('username') || 'Cliente';
                    const waMessage = encodeURIComponent(`¡Hola! Soy ${username}. He completado mi meta de ${loyaltyThreshold}kg en el Programa de Lealtad de Hielito Mexicano ❄️. Adjunto captura de mi historial para canjear mi premio.`);
                    
                    loyaltyContainer.classList.add('border', 'border-warning', 'border-4');
                    msg.innerHTML = `
                        <div class="d-flex flex-column align-items-center mt-3">
                            <strong class="text-warning mb-2 fs-5">🏆 ¡FELICIDADES! META ALCANZADA</strong>
                            <p class="small text-center mb-3">Toma una captura de pantalla de esta sección y presiona el botón para reclamar tu producto GRATIS por WhatsApp.</p>
                            <a href="https://wa.me/527352282129?text=${waMessage}" target="_blank" class="btn btn-warning fw-bold shadow-sm text-dark px-4">
                                <i class="bi bi-whatsapp me-2"></i> SOLICITAR PREMIO AHORA
                            </a>
                        </div>
                    `;
                } else {
                    msg.textContent = `Te faltan ${(loyaltyThreshold - accWeight).toFixed(1)} kg para tu regalo.`;
                }
            }
        }

        ordersCurrentPage = 1;
        renderOrdersPage();
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5 text-danger">Ocurrió un error al sincronizar tus pedidos.</td></tr>';
    }
}

function renderOrdersPage() {
    const tbody = document.getElementById('tabla-pedidos-body');
    const pagContainer = document.getElementById('pagination-pedidos');
    if (!tbody) return;

    if (allUserOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-5 text-muted">Aún no has realizado pedidos. ¡Tu hielito te espera!</td></tr>';
        if (pagContainer) pagContainer.innerHTML = '';
        return;
    }

    const start = (ordersCurrentPage - 1) * ordersPerPage;
    const end = start + ordersPerPage;
    const paginatedOrders = allUserOrders.slice(start, end);

    tbody.innerHTML = paginatedOrders.map(o => {
                let statusHTML = '';
                if (o.status === 'Cancelado') {
                    statusHTML = `<span class="badge rounded-pill bg-secondary"><i class="bi bi-x-circle me-1"></i> Cancelado</span>`;
                } else if (o.status === 'Enviado') {
                    statusHTML = `<span class="badge rounded-pill bg-info"><i class="bi bi-truck me-1"></i> En camino</span>`;
                } else if (o.status === 'Entregado') {
                    statusHTML = `<span class="badge rounded-pill bg-success"><i class="bi bi-check-circle me-1"></i> Entregado</span>`;
                } else {
                    statusHTML = `<span class="badge rounded-pill bg-warning text-dark"><i class="bi bi-clock-history me-1"></i> En preparación</span>`;
                }

                const deliveryInfo = o.status === 'Cancelado'
                    ? `<div class="mt-1 small text-danger italic">El pedido ha sido anulado.</div>`
                    : (o.delivery_date 
                        ? `<div class="mt-1 small fw-bold text-primary"><i class="bi bi-calendar-event me-1"></i> ${o.delivery_date} <i class="bi bi-alarm ms-1"></i> ${o.delivery_time || ''}</div>`
                        : `<div class="mt-1 small text-muted italic">Logística en curso...</div>`);

                const prizeBadge = o.has_loyalty_prize 
                    ? `<div class="mt-1"><span class="badge bg-warning text-dark border border-dark"><i class="bi bi-gift-fill me-1"></i> ¡INCLUYE REGALO!</span></div>` 
                    : '';

                // Botón de cancelación solo si está pendiente
                const cancelBtn = o.status === 'Pendiente de envío' 
                    ? `<button class="btn btn-link btn-sm text-danger p-0 d-block mt-2" onclick="cancelOrder(${o.id})">Cancelar pedido</button>` 
                    : '';

                return `
                <tr class="border-bottom">
                    <td class="ps-4"><span class="text-primary fw-bold">#${o.id}</span></td>
                    <td><div class="small">${o.items.map(i => `${i.quantity}x ${i.product_name}`).join('<br>')}</div></td>
                    <td>${statusHTML}${prizeBadge}${deliveryInfo}${cancelBtn}</td>
                    <td><div class="small">${new Date(o.created_at).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' })}</div></td>
                    <td class="text-end pe-4"><span class="fw-bold text-dark">$${o.total.toFixed(2)}</span></td>
                </tr>`;
    }).join('');

    if (pagContainer) {
        const totalPages = Math.ceil(allUserOrders.length / ordersPerPage);
        let html = '';
        for (let i = 1; i <= totalPages; i++) {
            html += `<button class="btn btn-sm ${i === ordersCurrentPage ? 'btn-primary' : 'btn-outline-primary'}" onclick="changeOrdersPage(${i})">${i}</button>`;
        }
        pagContainer.innerHTML = totalPages > 1 ? html : '';
    }
}

window.cancelOrder = async (id) => {
    if (!confirm(`¿Estás seguro de que deseas cancelar el pedido #${id}?`)) return;

    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/orders/${id}/cancel`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await res.json();
        if (res.ok) {
            alert(data.message);
            loadOrders(); // Recargar la lista
        } else {
            alert(data.error || "No se pudo cancelar el pedido.");
        }
    } catch (e) { alert("Error de conexión al intentar cancelar."); }
};

window.changeOrdersPage = (page) => {
    ordersCurrentPage = page;
    renderOrdersPage();
    const orderListDiv = document.getElementById('lista-pedidos');
    if (orderListDiv) orderListDiv.scrollTop = 0;
}

async function loadAdminOrders() {
    const tbody = document.getElementById('tabla-admin-orders-body');
    const token = localStorage.getItem('token');

    // Obtener valores de los filtros de fecha
    const startDateVal = document.getElementById('admin-filter-start')?.value;
    const endDateVal = document.getElementById('admin-filter-end')?.value;

    try {
        const response = await fetch(`${API_URL}/orders/admin/all`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        let orders = await response.json();

        if (!response.ok) {
            console.error("Error fetching admin orders:", orders.error || orders.msg || "Unknown error");
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-danger">Error al cargar pedidos: ${orders.error || orders.msg || "Acceso denegado o sesión expirada."}</td></tr>`;
            return;
        }


        // Aplicar filtro de rango de fechas si se han seleccionado
        if (startDateVal || endDateVal) {
            orders = orders.filter(o => {
                // Extraemos solo la parte de la fecha (YYYY-MM-DD) del ISO string del servidor
                const orderDateStr = o.created_at.split('T')[0];
                let pass = true;
                if (startDateVal) {
                    pass = pass && orderDateStr >= startDateVal;
                }
                if (endDateVal) {
                    pass = pass && orderDateStr <= endDateVal;
                }
                return pass;
            });
        }

        tbody.innerHTML = orders.map(o => {
            const dateStr = new Date(o.created_at).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' });
            const prizeBadge = o.has_loyalty_prize ? 
                `<div class="badge bg-warning text-dark border border-dark w-100 mb-1 py-2">
                    <i class="bi bi-gift-fill me-1"></i> LLEVAR REGALO
                 </div>` : '';

            const rowClass = o.status === 'Cancelado' ? 'table-secondary opacity-75' : (o.has_loyalty_prize ? 'table-warning' : '');

            return `
            <tr class="${rowClass}">
                <td class="fw-bold">#${o.id}</td>
                <td><small>${dateStr}</small></td>
                <td>
                    <strong>${o.username || 'Cliente'}</strong><br>
                    <small class="text-muted">${o.phone || ''}</small>
                    <div class="form-check form-switch mt-1">
                        <input class="form-check-input" type="checkbox" id="user-loyalty-${o.user_id}" ${o.user_is_loyalty_active ? 'checked' : ''} onchange="toggleUserLoyalty(${o.user_id}, this.checked)">
                        <label class="form-check-label small text-muted" style="font-size: 0.65rem;" for="user-loyalty-${o.user_id}">Lealtad Cliente</label>
                    </div>
                </td>
                <td class="fw-bold text-success">$${o.total.toFixed(2)}</td>
                <td>
                    <span class="badge ${o.payment_method === 'stripe' ? 'bg-info' : 'bg-success'} text-uppercase" style="font-size: 0.7rem;">
                        ${o.payment_method}
                    </span>
                </td>
                <td>${isLoyaltyActive ? `
                        ${prizeBadge}
                        <span class="badge bg-primary d-block mb-1">
                            ${o.user_accumulated_weight} / ${loyaltyThreshold} kg
                        </span>
                        ${o.user_accumulated_weight >= loyaltyThreshold ? 
                            `<button class="btn btn-dark btn-sm w-100 py-0" style="font-size: 0.7rem;" onclick="redeemLoyalty(${o.user_id}, '${o.username}')">🎁 CANJEAR</button>` : 
                            ''
                        }
                    ` : '<span class="text-muted small">Desactivado</span>'}</td>
                <td>
                    <small class="d-block mb-1">📍 ${o.address}</small>
                    <div class="small fw-bold text-muted border-top pt-1">${o.items.map(i => `${i.quantity}x ${i.product_name}`).join(', ')}</div>
                </td>
                <td>
                    <select class="form-select form-select-sm" id="status-${o.id}">
                        <option value="Pendiente de envío" ${o.status === 'Pendiente de envío' ? 'selected' : ''}>Pendiente</option>
                        <option value="En proceso" ${o.status === 'En proceso' ? 'selected' : ''}>En proceso</option>
                        <option value="Enviado" ${o.status === 'Enviado' ? 'selected' : ''}>Enviado</option>
                        <option value="Entregado" ${o.status === 'Entregado' ? 'selected' : ''}>Entregado</option>
                        <option value="Cancelado" ${o.status === 'Cancelado' ? 'selected' : ''}>Cancelado</option>
                    </select>
                </td>
                <td>
                    <input type="date" class="form-control form-control-sm mb-1" id="date-${o.id}" value="${o.delivery_date || ''}">
                    <input type="time" class="form-control form-control-sm" id="time-${o.id}" value="${o.delivery_time || ''}">
                </td>
                <td>
                    <button class="btn btn-sm btn-success w-100" onclick="updateOrderStatus(${o.id})">Guardar</button>
                </td>
            </tr>`;
        }).join('');
    } catch (error) {
        console.error("Error cargando panel de administración:", error);
    }
}

window.resetAdminFilters = () => {
    const start = document.getElementById('admin-filter-start');
    const end = document.getElementById('admin-filter-end');
    if (start) start.value = '';
    if (end) end.value = '';
    loadAdminOrders();
};

window.redeemLoyalty = async (userId, username) => {
    if (!confirm(`¿Confirmas que ya entregaste el premio a ${username}? Se reiniciará su progreso de lealtad.`)) return;
    
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/orders/admin/redeem-loyalty/${userId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
            alert(data.message);
            loadAdminOrders();
        }
    } catch (e) { alert("Error al canjear premio."); }
};

window.toggleUserLoyalty = async (userId, active) => {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/auth/admin/users/${userId}/toggle-loyalty`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ is_loyalty_active: active })
        });
        if (!res.ok) throw new Error();
        // No alertamos para que la experiencia sea fluida, pero podrías añadir un toast
    } catch (e) {
        alert("Error al actualizar el estado de lealtad del usuario.");
    }
};

window.updateOrderStatus = async (id) => {
    const status = document.getElementById(`status-${id}`).value;
    const delivery_date = document.getElementById(`date-${id}`).value;
    const delivery_time = document.getElementById(`time-${id}`).value;
    const token = localStorage.getItem('token');

    // Validación: Si el estatus es 'Enviado', la fecha y hora de entrega son obligatorias
    if (status === 'Enviado' && (!delivery_date || !delivery_time)) {
        alert("⚠️ Por favor, define la fecha y hora programada de entrega antes de marcar el pedido como 'Enviado'.");
        return;
    }

    try {
        const res = await fetch(`${API_URL}/orders/${id}/update`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ status, delivery_date, delivery_time })
        });
        if (res.ok) {
            alert("¡Pedido #" + id + " actualizado con éxito!");
            loadAdminOrders();
        }
    } catch (error) {
        alert("Error al actualizar el pedido.");
    }
}

async function toggleLoyaltyAvailability(available) {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/products/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ is_loyalty_active: available })
        });
        if (res.ok) {
            isLoyaltyActive = available;
            alert(available ? "✅ Programa de Lealtad ACTIVADO" : "⚠️ Programa de Lealtad DESACTIVADO");
            checkGlobalAvailability();
        }
    } catch (e) {
        alert("Error al cambiar configuración de lealtad.");
    }
}

async function toggleLoyaltyAvailability(available) {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/products/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ is_loyalty_active: available })
        });
        if (res.ok) {
            isLoyaltyActive = available;
            alert(available ? "✅ Programa de Lealtad ACTIVADO" : "⚠️ Programa de Lealtad DESACTIVADO");
            checkGlobalAvailability();
        }
    } catch (e) {
        alert("Error al cambiar configuración de lealtad.");
    }
}

async function toggleIceAvailability(available) {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/products/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ is_ice_available: available })
        });
        if (res.ok) {
            isIceAvailable = available;
            alert(available ? "✅ Hielo marcado como DISPONIBLE" : "⚠️ Hielo marcado como NO DISPONIBLE");
            checkGlobalAvailability();
        }
    } catch (e) {
        alert("Error al cambiar disponibilidad.");
    }
}

async function updateWhatsappPhone() {
    const val = document.getElementById('input-whatsapp-phone').value;
    const token = localStorage.getItem('token');
    if(!val) return alert("Ingresa un número válido");
    
    try {
        const res = await fetch(`${API_URL}/products/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ whatsapp_phone: val })
        });
        if (res.ok) {
            whatsappPhone = val;
            alert("✅ Teléfono de WhatsApp actualizado correctamente.");
        }
    } catch (e) { alert("Error al actualizar teléfono"); }
}

async function updateLoyaltyThreshold() {
    const val = document.getElementById('input-loyalty-threshold').value;
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/products/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ loyalty_threshold_kg: parseInt(val) })
        });
        if (res.ok) {
            loyaltyThreshold = parseInt(val);
            alert("✅ Meta de lealtad actualizada a " + val + "kg");
        }
    } catch (e) { alert("Error"); }
}

async function updateDeliveryThreshold() {
    const val = document.getElementById('input-delivery-threshold').value;
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/products/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ delivery_threshold_kg: parseInt(val) })
        });
        if (res.ok) {
            deliveryThreshold = parseInt(val);
            alert("✅ Límite de entrega inmediata actualizado a " + val + "kg");
            renderCart(); // Refrescar textos si el carrito está abierto
        }
    } catch (e) { alert("Error al actualizar límite de entrega"); }
}

async function checkGlobalAvailability() {
    try {
        const res = await fetch(`${API_URL}/products/config`);
        const data = await res.json();
        isIceAvailable = data.is_ice_available;
        isLoyaltyActive = data.is_loyalty_active;
        loyaltyThreshold = data.loyalty_threshold_kg;
        deliveryThreshold = data.delivery_threshold_kg || 20;
        whatsappPhone = data.whatsapp_phone || "527352282129";
        
        const switchIce = document.getElementById('switch-ice-availability');
        if (switchIce) switchIce.checked = isIceAvailable;

        const switchLoyalty = document.getElementById('switch-loyalty-active');
        if (switchLoyalty) switchLoyalty.checked = isLoyaltyActive;

        const loyaltyInput = document.getElementById('input-loyalty-threshold');
        if (loyaltyInput) loyaltyInput.value = loyaltyThreshold;

        const deliveryInput = document.getElementById('input-delivery-threshold');
        if (deliveryInput) deliveryInput.value = deliveryThreshold;

        const waInput = document.getElementById('input-whatsapp-phone');
        if (waInput) waInput.value = whatsappPhone;

        renderCart(); // Para actualizar mensajes en el carrito
    } catch (e) {
        console.error("Error al verificar disponibilidad:", e);
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

// --- FUNCIONES ADMINISTRATIVAS DEL CATÁLOGO ---

window.loadAdminCatalog = async () => {
    // This function is now responsible for loading categories and products
    // and populating window.allCategories.
    const res = await fetch(`${API_URL}/products/?t=${new Date().getTime()}`);
    const categories = await res.json();
    window.allCategories = categories; // Actualizar global

    // Listar Categorías
    const catList = document.getElementById('admin-categories-list');
    catList.innerHTML = categories.map(c => {
        // Para evitar que la imagen se vea rota si no hay URL
        const imageUrl = c.image_url && c.image_url !== 'null' ? c.image_url : 'https://placehold.co/40';
        return `
        <div class="list-group-item d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center ${!c.is_active ? 'opacity-50' : ''}">
                <img src="${imageUrl}" style="width: 30px; height: 30px; object-fit: cover; margin-right: 10px;" class="rounded">
                <div>
                    <strong>${c.name}</strong>
                    ${!c.is_active ? '<span class="badge bg-secondary ms-1" style="font-size: 0.6rem;">Oculto</span>' : ''}
                    <br><small class="text-muted">${c.products.length} productos</small>
                </div>
            </div>
            <div class="btn-group">
                <button class="btn btn-sm btn-outline-primary border-0" onclick="showEditCategoryModal(${c.id})"><i class="bi bi-pencil-square"></i></button>
                <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteCategory(${c.id})"><i class="bi bi-trash"></i></button>
            </div>
        </div>
    `}).join('');

    // Listar Productos (aplanados)
    const prodList = document.getElementById('admin-products-list');
    let html = '';
    categories.forEach(c => {
        c.products.forEach(p => {
            const imageUrl = p.image_url && p.image_url !== 'null' ? p.image_url : 'https://placehold.co/40';
            html += `
                <tr class="${!p.is_active ? 'table-light opacity-75' : ''}">
                    <td><img src="${imageUrl}" style="width: 30px; height: 30px; object-fit: cover;" class="rounded"></td>
                    <td>
                        <div class="fw-bold">${p.name}</div>
                        ${!p.is_active ? '<span class="badge bg-secondary" style="font-size: 0.6rem;">Inactivo</span>' : ''}
                    </td>
                    <td><span class="badge bg-light text-dark border">${c.name}</span></td>
                    <td class="text-primary fw-bold">$${p.price.toFixed(2)}</td>
                    <td>${p.stock}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary border-0" onclick="showEditProductModal(${p.id})"><i class="bi bi-pencil-square"></i></button>
                        <button class="btn btn-sm btn-outline-danger border-0" onclick="deleteProduct(${p.id})"><i class="bi bi-trash"></i></button>
                    </td>
                </tr>`;
        });
    });
    prodList.innerHTML = html || '<tr><td colspan="6" class="text-center p-4">No hay productos aún</td></tr>';

    // Llenar select de categorías en el modal de producto
    const prodCatSelect = document.getElementById('prod-cat');
    prodCatSelect.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
};

window.showCategoryModal = () => {
    document.getElementById('form-admin-category').reset();
    document.getElementById('cat-id').value = '';
    document.getElementById('cat-active').checked = true;
    document.getElementById('cat-modal-title').textContent = 'Nueva Categoría';
    document.getElementById('cat-img-file').value = ''; // Clear file input
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalAdminCategory')).show();
};

window.showEditCategoryModal = (id) => {
    const cat = window.allCategories.find(c => c.id === id);
    document.getElementById('cat-id').value = cat.id;
    document.getElementById('cat-name').value = cat.name;
    document.getElementById('cat-desc').value = cat.description || '';
    document.getElementById('cat-active').checked = cat.is_active;
    document.getElementById('cat-img-file').value = ''; // Clear file input, user can choose new one
    document.getElementById('cat-modal-title').textContent = 'Editar Categoría';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalAdminCategory')).show();
};

async function uploadFile(fileInputId) {
    const fileInput = document.getElementById(fileInputId);
    if (!fileInput || fileInput.files.length === 0) return null;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    const res = await fetch(`${API_URL}/products/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData
    });
    if (res.ok) {
        const data = await res.json();
        return data.url;
    }
    return null;
}

window.saveCategory = async () => {
    const id = document.getElementById('cat-id').value;
    const newImageUrl = await uploadFile('cat-img-file');
    
    // Si estamos editando y no subimos imagen nueva, mantenemos la anterior
    let imageUrl = newImageUrl;
    if (id && !newImageUrl) {
        const cat = window.allCategories.find(c => c.id == id);
        imageUrl = cat.image_url;
    }

    const payload = {
        name: document.getElementById('cat-name').value,
        description: document.getElementById('cat-desc').value,
        image_url: imageUrl || '',
        is_active: document.getElementById('cat-active').checked
    };

    const url = id ? `${API_URL}/products/categories/${id}` : `${API_URL}/products/categories`;
    const res = await fetch(url, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(payload)
    });
    if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('modalAdminCategory')).hide();
        loadAdminCatalog();
        loadDynamicStore();
    }
};

window.deleteCategory = async (id) => {
    if (!confirm("¿Eliminar categoría? Esto fallará si tiene productos asociados.")) return;
    const res = await fetch(`${API_URL}/products/categories/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) { loadAdminCatalog(); loadDynamicStore(); }
    else alert("No se puede eliminar: comprueba que no tenga productos.");
};

window.showProductModal = () => {
    document.getElementById('form-admin-product').reset();
    document.getElementById('prod-id').value = '';
    document.getElementById('prod-active').checked = true;
    document.getElementById('prod-img-file').value = ''; // Clear file input
    document.getElementById('prod-modal-title').textContent = 'Nuevo Producto';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalAdminProduct')).show();
};

window.showEditProductModal = (id) => {
    let product = null;
    window.allCategories.forEach(c => {
        const p = c.products.find(prod => prod.id === id);
        if (p) product = { ...p, category_id: c.id };
    });

    document.getElementById('prod-id').value = product.id;
    document.getElementById('prod-name').value = product.name;
    document.getElementById('prod-cat').value = product.category_id;
    document.getElementById('prod-price').value = product.price;
    document.getElementById('prod-stock').value = product.stock;
    document.getElementById('prod-weight').value = product.weight;
    document.getElementById('prod-active').checked = product.is_active;
    document.getElementById('prod-ideal').value = product.ideal_for || '';
    document.getElementById('prod-img-file').value = ''; // Clear file input, user can choose new one
    document.getElementById('prod-desc').value = product.description || '';
    document.getElementById('prod-modal-title').textContent = 'Editar Producto';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalAdminProduct')).show();
};

window.saveProduct = async () => {
    const id = document.getElementById('prod-id').value;
    const newImageUrl = await uploadFile('prod-img-file');

    let imageUrl = newImageUrl;
    if (id && !newImageUrl) {
        // Buscar imagen previa
        window.allCategories.forEach(c => {
            const p = c.products.find(prod => prod.id == id);
            if (p) imageUrl = p.image_url;
        });
    }

    const payload = {
        name: document.getElementById('prod-name').value,
        category_id: document.getElementById('prod-cat').value,
        price: document.getElementById('prod-price').value,
        stock: document.getElementById('prod-stock').value,
        weight: document.getElementById('prod-weight').value,
        image_url: imageUrl || '',
        ideal_for: document.getElementById('prod-ideal').value,
        description: document.getElementById('prod-desc').value,
        is_active: document.getElementById('prod-active').checked
    };

    const url = id ? `${API_URL}/products/${id}` : `${API_URL}/products/`;
    const res = await fetch(url, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(payload)
    });
    if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('modalAdminProduct')).hide();
        loadAdminCatalog();
        loadDynamicStore();
    }
};

window.deleteProduct = async (id) => {
    if (!confirm("¿Eliminar este producto?")) return;
    const res = await fetch(`${API_URL}/products/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) { loadAdminCatalog(); loadDynamicStore(); }
};

window.loadAdminPromotionsTable = async () => {
    // Ensure categories and products are loaded for the promotion item dropdowns
    if (!window.allCategories || window.allCategories.length === 0) await loadAdminCatalog();
    const res = await fetch(`${API_URL}/promotions/`);
    const promos = await res.json();
    const list = document.getElementById('admin-promos-list');
    list.innerHTML = promos.map(p => `
        <tr>
            <td>${p.id}</td>
            <td>
                <strong>${p.promo_name}</strong><br>
                <small class="text-muted">${p.description || ''}</small>
                <div class="mt-2">
                    ${p.items.map(i => `<span class="badge bg-light text-dark border-1 border me-1" style="font-size: 0.65rem;">${i.quantity}x ${i.product_name}</span>`).join('')}
                </div>
            </td>
            <td><small>${p.header_title || ''}</small><br><small class="text-muted">${p.header_subtitle || ''}</small></td>
            <td><span class="text-decoration-line-through text-muted">$${p.original_price.toFixed(2)}</span><br><span class="fw-bold text-success">$${p.promo_price.toFixed(2)}</span></td>
            <td>${new Date(p.expiration_date).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</td>
            <td><span class="badge bg-${p.color_scheme}">${p.color_scheme}</span></td>
            <td>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-primary border-0" onclick="showEditPromoModal(${p.id})"><i class="bi bi-pencil-square"></i></button>
                    <button class="btn btn-sm btn-outline-danger border-0" onclick="deletePromo(${p.id})"><i class="bi bi-trash"></i></button>
                </div>
            </td>
        </tr>
    `).join('');
    window.allPromotions = promos; // Guardar para edición
};

window.deletePromo = async (id) => {
    if (!confirm("¿Eliminar promoción?")) return;
    const res = await fetch(`${API_URL}/promotions/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) { loadAdminPromotionsTable(); loadPromotions(); }
};

window.showPromoModal = () => {
    document.getElementById('form-admin-promotion').reset();
    document.getElementById('promo-id').value = ''; // Clear ID for new promo
    document.getElementById('modalAdminPromotion').querySelector('.modal-title').textContent = 'Configurar Nueva Promoción';
    document.getElementById('promo-items-container').innerHTML = '';
    // Agregamos una fila inicial por defecto
    addPromoItemRow();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalAdminPromotion')).show();
};

window.addPromoItemRow = (initialProductId = null, initialQuantity = 1) => {
    const container = document.getElementById('promo-items-container');
    const div = document.createElement('div');
    div.className = 'row g-2 mb-2 align-items-end promo-item-row';
    
    let options = '';
    if (!window.allCategories) { console.warn("allCategories not loaded, loading now..."); loadAdminCatalog(); }
    
    window.allCategories.forEach(c => {
        c.products.forEach(p => {
            const selected = (initialProductId === p.id) ? 'selected' : '';
            options += `<option value="${p.id}" data-price="${p.price}" ${selected}>${c.name} - ${p.name}</option>`;
        });
    });

    div.innerHTML = `
        <div class="col-8">
            <label class="small text-muted">Producto</label>
            <select class="form-select form-select-sm item-product-id" onchange="autoCalculateOriginalPrice()">${options}</select>
        </div>
        <div class="col-3">
            <label class="small text-muted">Cant.</label>
            <input type="number" class="form-control form-control-sm item-quantity" value="${initialQuantity}" min="1" oninput="autoCalculateOriginalPrice()">
        </div>
        <div class="col-1">
            <button type="button" class="btn btn-sm btn-outline-danger border-0" onclick="this.parentElement.parentElement.remove(); autoCalculateOriginalPrice();"><i class="bi bi-x-circle"></i></button>
        </div>
    `;
    container.appendChild(div);
    autoCalculateOriginalPrice();
};

window.autoCalculateOriginalPrice = () => {
    const rows = document.querySelectorAll('.promo-item-row');
    let total = 0;
    rows.forEach(row => {
        const select = row.querySelector('.item-product-id');
        const qty = parseInt(row.querySelector('.item-quantity').value) || 0;
        const price = parseFloat(select.options[select.selectedIndex]?.getAttribute('data-price')) || 0;
        total += (price * qty);
    });
    const origInput = document.getElementById('promo-price-orig');
    if (origInput) {
        origInput.value = total.toFixed(2);
        updateSavingsPercentage();
    }
};

window.updateSavingsPercentage = () => {
    const orig = parseFloat(document.getElementById('promo-price-orig').value) || 0;
    const final = parseFloat(document.getElementById('promo-price-final').value) || 0;
    const badge = document.getElementById('promo-savings-badge');
    
    if (orig > 0 && final > 0 && final < orig) {
        const ahorro = Math.round((1 - (final / orig)) * 100);
        badge.textContent = `-${ahorro}%`;
        badge.classList.remove('d-none');
    } else {
        badge.classList.add('d-none');
    }
};

window.showEditPromoModal = (id) => {
    const promo = window.allPromotions.find(p => p.id === id);
    if (!promo) {
        alert("Promoción no encontrada para editar.");
        return;
    }

    document.getElementById('promo-id').value = promo.id;
    document.getElementById('modalAdminPromotion').querySelector('.modal-title').textContent = 'Editar Promoción';
    document.getElementById('promo-header-title').value = promo.header_title;
    document.getElementById('promo-header-subtitle').value = promo.header_subtitle || '';
    document.getElementById('promo-name').value = promo.promo_name;
    document.getElementById('promo-desc').value = promo.description || '';
    document.getElementById('promo-price-orig').value = promo.original_price;
    document.getElementById('promo-price-final').value = promo.promo_price;
    
    const expDate = new Date(promo.expiration_date);
    const formattedExpDate = expDate.toISOString().slice(0, 16);
    document.getElementById('promo-expire').value = formattedExpDate;
    
    document.getElementById('promo-color').value = promo.color_scheme;

    const container = document.getElementById('promo-items-container');
    container.innerHTML = '';
    promo.items.forEach(item => addPromoItemRow(item.product_id, item.quantity));

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalAdminPromotion')).show();
};

window.savePromotion = async () => {
    const id = document.getElementById('promo-id').value;
    const itemRows = document.querySelectorAll('.promo-item-row');
    const items = Array.from(itemRows).map(row => ({
        product_id: parseInt(row.querySelector('.item-product-id').value),
        quantity: parseInt(row.querySelector('.item-quantity').value)
    }));

    const payload = {
        header_title: document.getElementById('promo-header-title').value,
        header_subtitle: document.getElementById('promo-header-subtitle').value,
        promo_name: document.getElementById('promo-name').value,
        description: document.getElementById('promo-desc').value,
        original_price: document.getElementById('promo-price-orig').value,
        promo_price: document.getElementById('promo-price-final').value,
        expiration_date: document.getElementById('promo-expire').value,
        color_scheme: document.getElementById('promo-color').value,
        items: items
    };

    const url = id ? `${API_URL}/promotions/${id}` : `${API_URL}/promotions/`;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(payload)
    });

    if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('modalAdminPromotion')).hide();
        loadAdminPromotionsTable();
        loadPromotions();
    } else {
        const err = await res.json();
        alert("Error: " + (err.error || "No se pudo crear la promoción"));
    }
};