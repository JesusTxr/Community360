(function () {
    'use strict';

    // Referencias DOM generales, tema y autenticación
    const loadingScreen = document.getElementById('loadingScreen');
    const protectedApp = document.getElementById('protectedApp');
    const adminNombreEl = document.getElementById('adminNombre');
    const adminEmailEl = document.getElementById('adminEmail');
    const btnLogout = document.getElementById('btnLogout');
    const btnThemeToggle = document.getElementById('btnThemeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const themeLabel = document.getElementById('themeLabel');

    // Referencias DOM - Bloque A (Tiempo Real — WebSockets / Firestore)
    const wsStatusBadge = document.getElementById('wsStatusBadge');
    const wsStatusText = document.getElementById('wsStatusText');
    const rtActualizadoEn = document.getElementById('rtActualizadoEn');
    const realtimeToast = document.getElementById('realtimeToast');
    const rtTotalInteracciones = document.getElementById('rtTotalInteracciones');
    const rtSentimientoPromedio = document.getElementById('rtSentimientoPromedio');
    const rtTasaPositividad = document.getElementById('rtTasaPositividad');
    const rtPromedioReacciones = document.getElementById('rtPromedioReacciones');
    const rtHeatmapMatrix = document.getElementById('rtHeatmapMatrix');
    const rtListaInteracciones = document.getElementById('rtListaInteracciones');
    const rtTopEtiquetasList = document.getElementById('rtTopEtiquetasList');
    const semBarPos = document.getElementById('semBarPos');
    const semBarNeu = document.getElementById('semBarNeu');
    const semBarNeg = document.getElementById('semBarNeg');
    const semPosConteo = document.getElementById('semPosConteo');
    const semPosPct = document.getElementById('semPosPct');
    const semNeuConteo = document.getElementById('semNeuConteo');
    const semNeuPct = document.getElementById('semNeuPct');
    const semNegConteo = document.getElementById('semNegConteo');
    const semNegPct = document.getElementById('semNegPct');
    const semModeracionNota = document.getElementById('semModeracionNota');

    // Referencias DOM - Bloque B (Histórico REST — TiDB Cloud)
    const histErrorBanner = document.getElementById('histErrorBanner');
    const etlMetaBadge = document.getElementById('etlMetaBadge');
    const kpiTotalUsuarios = document.getElementById('kpiTotalUsuarios');
    const kpiMensajesSub = document.getElementById('kpiMensajesSub');
    const kpiUsuariosActivos = document.getElementById('kpiUsuariosActivos');
    const kpiActivosPct = document.getElementById('kpiActivosPct');
    const kpiUsuariosRiesgo = document.getElementById('kpiUsuariosRiesgo');
    const kpiInactivosSub = document.getElementById('kpiInactivosSub');
    const kpiTotalArtistas = document.getElementById('kpiTotalArtistas');
    const kpiSentimientoGlobalSub = document.getElementById('kpiSentimientoGlobalSub');
    const kpiUsuariosAnonimizados = document.getElementById('kpiUsuariosAnonimizados');
    const mapPointsBadge = document.getElementById('mapPointsBadge');
    const privacyMapNote = document.getElementById('privacyMapNote');

    // Instancias activas
    let socket = null;
    let toastTimer = null;
    let ultimasMetricasCache = null;

    let chartRtCanales = null;
    let chartRtTemas = null;
    let chartEstatus = null;
    let chartPlataformas = null;
    let chartIntereses = null;
    let leafletMap = null;
    let heatLayer = null;

    // Paleta editorial armónica para Chart.js
    const PALETA_EDITORIAL = [
        '#0F766E',
        '#C85A32',
        '#D97706',
        '#3B82F6',
        '#6366F1',
        '#64748B',
        '#059669',
        '#BE123C'
    ];

    const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

    // =========================================================================
    // SISTEMA DE TEMAS (MODO CLARO / MODO OSCURO) + SINCRONIZACIÓN DE GRÁFICAS
    // =========================================================================

    function esModoOscuro() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function obtenerTokensTema() {
        const dark = esModoOscuro();
        return {
            dark,
            textColor: dark ? '#A1A1AA' : '#52525B',
            gridColor: dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(24, 24, 27, 0.07)',
            surfaceBorder: dark ? '#16181C' : '#FFFFFF',
            accentPrimary: dark ? '#14B8A6' : '#0F766E',
            accentSecondary: dark ? '#E07A5F' : '#C85A32'
        };
    }

    function configurarDefaultsChart() {
        if (!window.Chart) return;
        const t = obtenerTokensTema();
        Chart.defaults.color = t.textColor;
        Chart.defaults.borderColor = t.gridColor;
        Chart.defaults.font.family = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";
    }

    function aplicarTemaAGraficasActivas() {
        configurarDefaultsChart();
        const t = obtenerTokensTema();

        const todasLasGraficas = [
            chartRtCanales,
            chartRtTemas,
            chartEstatus,
            chartPlataformas,
            chartIntereses
        ];

        for (const instancia of todasLasGraficas) {
            if (!instancia) continue;

            if (instancia.options.plugins?.legend?.labels) {
                instancia.options.plugins.legend.labels.color = t.textColor;
            }

            if (instancia.options.scales) {
                for (const eje of Object.values(instancia.options.scales)) {
                    if (eje.ticks) eje.ticks.color = t.textColor;
                    if (eje.grid && eje.grid.display !== false) {
                        eje.grid.color = t.gridColor;
                    }
                }
            }

            if (instancia.config.type === 'doughnut' && instancia.data.datasets[0]) {
                instancia.data.datasets[0].borderColor = t.surfaceBorder;
            }

            if (instancia === chartRtCanales && instancia.data.datasets[0]) {
                instancia.data.datasets[0].backgroundColor = t.accentPrimary;
                instancia.data.datasets[0].borderColor = t.accentPrimary;
            }

            if (instancia === chartPlataformas && instancia.data.datasets[0]) {
                instancia.data.datasets[0].backgroundColor = t.accentPrimary;
                instancia.data.datasets[0].borderColor = t.accentPrimary;
            }

            if (instancia === chartIntereses && instancia.data.datasets[0]) {
                instancia.data.datasets[0].backgroundColor = t.accentSecondary;
                instancia.data.datasets[0].borderColor = t.accentSecondary;
            }

            instancia.update();
        }

        if (ultimasMetricasCache) {
            actualizarMatrizCalorTiempoReal(ultimasMetricasCache);
        }
    }

    function actualizarBotonTema() {
        if (!btnThemeToggle) return;
        if (esModoOscuro()) {
            themeIcon.innerHTML = ICON_SUN;
            themeLabel.textContent = 'Modo Claro';
        } else {
            themeIcon.innerHTML = ICON_MOON;
            themeLabel.textContent = 'Modo Oscuro';
        }
    }

    configurarDefaultsChart();
    actualizarBotonTema();

    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const nuevoTema = esModoOscuro() ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', nuevoTema);
            localStorage.setItem('c360_theme', nuevoTema);
            actualizarBotonTema();
            aplicarTemaAGraficasActivas();
        });
    }

    // =========================================================================
    // UTILIDADES GENERALES
    // =========================================================================

    function expulsarAlLogin() {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        localStorage.removeItem('c360_token');
        window.location.replace('/login.html');
    }

    function formatearNumero(valor) {
        return Number(valor ?? 0).toLocaleString('es-MX');
    }

    function formatearEtiqueta(texto) {
        if (!texto) return '-';
        return String(texto)
            .trim()
            .replace(/_/g, ' ')
            .split(/\s+/)
            .map((palabra) =>
                palabra ? palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase() : ''
            )
            .join(' ');
    }

    const MAPA_ENCABEZADOS_TIPO = {
        mensaje: 'Mensaje',
        comentario: 'Comentario',
        reaccion: 'Reacción',
        respuesta_encuesta: 'Encuesta',
        rsvp_evento: 'Evento'
    };

    function obtenerNombreCortoTipo(tipoRaw) {
        const clave = String(tipoRaw || '').trim().toLowerCase();
        return MAPA_ENCABEZADOS_TIPO[clave] || formatearEtiqueta(tipoRaw);
    }

    function iniciarObservadorNavegacion() {
        const enlaces = Array.from(document.querySelectorAll('.sidebar-nav a[href^="#"]'));
        if (enlaces.length === 0) return;

        const items = [];
        for (const link of enlaces) {
            const idDestino = link.getAttribute('href').slice(1);
            const seccion = document.getElementById(idDestino);
            if (seccion) {
                items.push({ id: idDestino, link, seccion });
            }
        }
        if (items.length === 0) return;

        let bloqueoClickTimer = null;
        let bloqueadoPorClick = false;

        function marcarActivo(idActivo) {
            for (const item of items) {
                item.link.classList.toggle('active', item.id === idActivo);
            }
        }

        function actualizarPorPosicion() {
            if (bloqueadoPorClick) return;

            // Si el usuario llegó al final del documento, activar la última sección
            const alFinalDePagina =
                window.innerHeight + window.scrollY >=
                document.documentElement.scrollHeight - 35;

            if (alFinalDePagina) {
                marcarActivo(items[items.length - 1].id);
                return;
            }

            // Elegir la última sección cuyo borde superior ya cruzó la franja superior (180px)
            // Esto resuelve sub-secciones anidadas (#seccionTendencias y #seccionFeedVivo dentro de #bloqueTiempoReal)
            const umbralSuperior = 180;
            let elegido = items[0].id;

            for (const item of items) {
                const top = item.seccion.getBoundingClientRect().top;
                if (top <= umbralSuperior) {
                    elegido = item.id;
                } else {
                    break;
                }
            }

            marcarActivo(elegido);
        }

        for (const item of items) {
            item.link.addEventListener('click', () => {
                bloqueadoPorClick = true;
                marcarActivo(item.id);

                if (bloqueoClickTimer) clearTimeout(bloqueoClickTimer);
                bloqueoClickTimer = setTimeout(() => {
                    bloqueadoPorClick = false;
                }, 800);
            });
        }

        // Si la URL ya trae un hash inicial (#seccionTendencias, etc.), respetarlo
        const hashInicial = window.location.hash ? window.location.hash.slice(1) : '';
        if (hashInicial && items.some((i) => i.id === hashInicial)) {
            marcarActivo(hashInicial);
        } else {
            actualizarPorPosicion();
        }

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver(() => actualizarPorPosicion(), {
                root: null,
                rootMargin: '-10% 0px -55% 0px',
                threshold: [0, 0.1, 0.5]
            });
            items.forEach((item) => observer.observe(item.seccion));
        }

        window.addEventListener('scroll', actualizarPorPosicion, { passive: true });
    }

    // =========================================================================
    // BLOQUE A: MONITOREO EN TIEMPO REAL (WEBSOCKETS — FIREBASE FIRESTORE)
    // =========================================================================

    function actualizarIndicadorSocket(conectado) {
        wsStatusBadge.classList.toggle('connected', conectado);
        wsStatusBadge.classList.toggle('disconnected', !conectado);
        wsStatusText.textContent = conectado ? 'Conectado en vivo' : 'Desconectado';
    }

    function mostrarToastTiempoReal(accion, idInteraccion) {
        const textos = {
            POST: 'POST recibido desde Postman · Nueva interacción registrada',
            PUT: 'PUT recibido desde Postman · Interacción modificada',
            DELETE: 'DELETE recibido desde Postman · Interacción eliminada'
        };
        const claseTipo =
            accion === 'POST' ? 'toast-post' : accion === 'PUT' ? 'toast-put' : 'toast-delete';

        realtimeToast.className = `realtime-toast visible ${claseTipo}`;
        realtimeToast.textContent = '';

        const spanMsg = document.createElement('span');
        spanMsg.textContent = textos[accion] || `Evento en tiempo real (${accion})`;

        const spanId = document.createElement('span');
        spanId.className = 'mono';
        spanId.textContent = `ID: ${idInteraccion || '-'}`;

        realtimeToast.appendChild(spanMsg);
        realtimeToast.appendChild(spanId);

        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            realtimeToast.classList.remove('visible');
        }, 5500);
    }

    function actualizarKPIsTiempoReal(metricas) {
        rtTotalInteracciones.textContent = formatearNumero(metricas.total_interacciones);

        const sent = Number(metricas.sentimiento_promedio ?? 0);
        rtSentimientoPromedio.textContent = (sent > 0 ? '+' : '') + sent.toFixed(3);
        if (sent > 0) {
            rtSentimientoPromedio.style.color = 'var(--positive)';
        } else if (sent < 0) {
            rtSentimientoPromedio.style.color = 'var(--negative)';
        } else {
            rtSentimientoPromedio.style.color = 'var(--neutral)';
        }

        const positividad = Number(metricas.tasa_positividad ?? 0);
        rtTasaPositividad.textContent = `${positividad.toFixed(1)}%`;

        const promReacc = Number(metricas.promedio_reacciones ?? 0);
        rtPromedioReacciones.textContent = promReacc.toFixed(2);

        if (metricas.actualizado_en) {
            const fecha = new Date(metricas.actualizado_en);
            rtActualizadoEn.textContent = `Sincronización: ${fecha.toLocaleTimeString('es-MX')}`;
        }
    }

    function actualizarGraficasTiempoReal(metricas) {
        const t = obtenerTokensTema();
        const porCanal = metricas.por_canal || {};
        const canalesLabels = Object.keys(porCanal);
        const canalesData = Object.values(porCanal).map((n) => Number(n || 0));

        // 1. Gráfica de Barras en Tiempo Real: Interacciones por Canal
        if (!chartRtCanales) {
            const ctxCanales = document.getElementById('chartRtCanales').getContext('2d');
            chartRtCanales = new Chart(ctxCanales, {
                type: 'bar',
                data: {
                    labels: canalesLabels,
                    datasets: [
                        {
                            label: 'Interacciones',
                            data: canalesData,
                            backgroundColor: t.accentPrimary,
                            borderColor: t.accentPrimary,
                            borderWidth: 1,
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { precision: 0, color: t.textColor },
                            grid: { color: t.gridColor }
                        },
                        x: {
                            ticks: { color: t.textColor },
                            grid: { display: false }
                        }
                    }
                }
            });
        } else {
            chartRtCanales.data.labels = canalesLabels;
            chartRtCanales.data.datasets[0].data = canalesData;
            chartRtCanales.update();
        }

        // 2. Gráfica de Dona en Tiempo Real: Distribución por Tema
        const porTema = metricas.por_tema || {};
        const temasLabels = Object.keys(porTema).map((tema) => formatearEtiqueta(tema));
        const temasData = Object.values(porTema).map((n) => Number(n || 0));
        const temasColores = temasLabels.map(
            (_, idx) => PALETA_EDITORIAL[idx % PALETA_EDITORIAL.length]
        );

        if (!chartRtTemas) {
            const ctxTemas = document.getElementById('chartRtTemas').getContext('2d');
            chartRtTemas = new Chart(ctxTemas, {
                type: 'doughnut',
                data: {
                    labels: temasLabels,
                    datasets: [
                        {
                            data: temasData,
                            backgroundColor: temasColores,
                            borderColor: t.surfaceBorder,
                            borderWidth: 2,
                            hoverOffset: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '62%',
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                color: t.textColor,
                                boxWidth: 11,
                                padding: 11,
                                usePointStyle: true
                            }
                        }
                    }
                }
            });
        } else {
            chartRtTemas.data.labels = temasLabels;
            chartRtTemas.data.datasets[0].data = temasData;
            chartRtTemas.data.datasets[0].backgroundColor = temasColores;
            chartRtTemas.data.datasets[0].borderColor = t.surfaceBorder;
            chartRtTemas.update();
        }
    }

    function obtenerEstiloCeldaCalor(valor, maximo) {
        const dark = esModoOscuro();

        if (valor <= 0 || maximo <= 0) {
            return {
                bg: dark ? '#1E2026' : '#F6F6F3',
                color: dark ? '#71717A' : '#A1A1AA'
            };
        }

        const ratio = valor / maximo;
        if (ratio >= 0.72) {
            return {
                bg: dark
                    ? `rgba(224, 122, 95, ${(0.55 + ratio * 0.35).toFixed(2)})`
                    : `rgba(200, 90, 50, ${(0.72 + ratio * 0.25).toFixed(2)})`,
                color: '#FFFFFF'
            };
        }
        if (ratio >= 0.35) {
            return {
                bg: dark
                    ? `rgba(20, 184, 166, ${(0.38 + ratio * 0.42).toFixed(2)})`
                    : `rgba(15, 118, 110, ${(0.6 + ratio * 0.32).toFixed(2)})`,
                color: '#FFFFFF'
            };
        }
        return {
            bg: dark
                ? `rgba(20, 184, 166, ${(0.16 + ratio * 0.4).toFixed(2)})`
                : `rgba(15, 118, 110, ${(0.14 + ratio * 0.45).toFixed(2)})`,
            color: dark ? '#F4F4F5' : '#18181B'
        };
    }

    function actualizarMatrizCalorTiempoReal(metricas) {
        const matriz = metricas.matriz_canal_tipo || {};
        const canales = Object.keys(matriz);
        const tipos = Object.keys(metricas.por_tipo || {});

        rtHeatmapMatrix.textContent = '';

        if (canales.length === 0 || tipos.length === 0) {
            const msg = document.createElement('p');
            msg.className = 'panel-subtitle';
            msg.textContent = 'Sin datos suficientes para construir la matriz de actividad.';
            rtHeatmapMatrix.appendChild(msg);
            return;
        }

        let maxValor = 0;
        for (const canal of canales) {
            for (const tipo of tipos) {
                const v = Number(matriz[canal]?.[tipo] || 0);
                if (v > maxValor) maxValor = v;
            }
        }

        const table = document.createElement('table');
        table.className = 'heatmap-table';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');

        const thCorner = document.createElement('th');
        thCorner.className = 'row-header';
        thCorner.textContent = 'Canal \\ Tipo';
        headRow.appendChild(thCorner);

        for (const tipo of tipos) {
            const th = document.createElement('th');
            th.textContent = obtenerNombreCortoTipo(tipo);
            headRow.appendChild(th);
        }

        const thTotal = document.createElement('th');
        thTotal.textContent = 'Total';
        headRow.appendChild(thTotal);

        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        for (const canal of canales) {
            const tr = document.createElement('tr');

            const thCanal = document.createElement('th');
            thCanal.className = 'row-header';
            thCanal.textContent = canal;
            tr.appendChild(thCanal);

            let sumaFila = 0;

            for (const tipo of tipos) {
                const conteo = Number(matriz[canal]?.[tipo] || 0);
                sumaFila += conteo;

                const td = document.createElement('td');
                td.className = 'heatmap-cell';
                const estilo = obtenerEstiloCeldaCalor(conteo, maxValor);
                td.style.backgroundColor = estilo.bg;
                td.style.color = estilo.color;
                td.textContent = conteo;
                td.title = `${canal} · ${obtenerNombreCortoTipo(tipo)}: ${conteo} interacciones`;
                tr.appendChild(td);
            }

            const tdTotal = document.createElement('td');
            tdTotal.className = 'heatmap-total-cell';
            tdTotal.textContent = sumaFila;
            tr.appendChild(tdTotal);

            tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        rtHeatmapMatrix.appendChild(table);
    }

    function actualizarTopEtiquetasTiempoReal(metricas) {
        const top = Array.isArray(metricas.top_etiquetas) ? metricas.top_etiquetas : [];
        rtTopEtiquetasList.textContent = '';

        if (top.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'panel-subtitle';
            empty.style.marginBottom = '0';
            empty.textContent = 'Aún no hay etiquetas registradas en las interacciones.';
            rtTopEtiquetasList.appendChild(empty);
            return;
        }

        const maxConteo = Math.max(...top.map((t) => Number(t.conteo || 0)), 1);

        top.forEach((item, index) => {
            const conteo = Number(item.conteo || 0);
            const porcentajeAncho = Math.max(6, Math.round((conteo / maxConteo) * 100));

            const row = document.createElement('div');
            row.className = 'trending-tag-row';

            const header = document.createElement('div');
            header.className = 'trending-tag-header';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'trending-tag-name';
            nameSpan.textContent = `${index + 1}. #${item.etiqueta}`;

            const countSpan = document.createElement('span');
            countSpan.className = 'trending-tag-count';
            countSpan.textContent = `${formatearNumero(conteo)} ${conteo === 1 ? 'mención' : 'menciones'}`;

            header.appendChild(nameSpan);
            header.appendChild(countSpan);

            const track = document.createElement('div');
            track.className = 'trending-bar-track';

            const fill = document.createElement('div');
            fill.className = 'trending-bar-fill';
            fill.style.width = `${porcentajeAncho}%`;

            track.appendChild(fill);
            row.appendChild(header);
            row.appendChild(track);
            rtTopEtiquetasList.appendChild(row);
        });
    }

    function actualizarSemaforoTiempoReal(metricas) {
        const sem = metricas.semaforo_sentimiento || {};
        const pos = sem.positivas || { conteo: 0, porcentaje: 0 };
        const neu = sem.neutras || { conteo: 0, porcentaje: 0 };
        const neg = sem.negativas || { conteo: 0, porcentaje: 0 };

        const posPct = Number(pos.porcentaje || 0);
        const neuPct = Number(neu.porcentaje || 0);
        const negPct = Number(neg.porcentaje || 0);

        semPosConteo.textContent = formatearNumero(pos.conteo);
        semPosPct.textContent = `${posPct.toFixed(1)}%`;

        semNeuConteo.textContent = formatearNumero(neu.conteo);
        semNeuPct.textContent = `${neuPct.toFixed(1)}%`;

        semNegConteo.textContent = formatearNumero(neg.conteo);
        semNegPct.textContent = `${negPct.toFixed(1)}%`;

        semBarPos.style.width = `${posPct}%`;
        semBarNeu.style.width = `${neuPct}%`;
        semBarNeg.style.width = `${negPct}%`;

        if (negPct >= 30) {
            semModeracionNota.textContent = `Alerta de moderación: ${negPct.toFixed(1)}% negativas (< -0.10)`;
            semModeracionNota.style.color = 'var(--negative)';
        } else {
            semModeracionNota.textContent = 'Clima comunitario estable · Umbrales: > +0.10 | [-0.10, +0.10] | < -0.10';
            semModeracionNota.style.color = 'var(--text-muted)';
        }
    }

    function actualizarFeedTiempoReal(metricas) {
        const lista = Array.isArray(metricas.ultimas_interacciones)
            ? metricas.ultimas_interacciones
            : [];

        rtListaInteracciones.textContent = '';

        if (lista.length === 0) {
            const vacio = document.createElement('li');
            vacio.className = 'interaction-item';
            vacio.textContent = 'No hay interacciones registradas.';
            rtListaInteracciones.appendChild(vacio);
            return;
        }

        for (const item of lista) {
            const li = document.createElement('li');
            li.className = 'interaction-item';

            const top = document.createElement('div');
            top.className = 'interaction-top';

            const idUser = document.createElement('span');
            idUser.className = 'interaction-id-user';
            const alias = item.usuario_snapshot?.alias || item.id_usuario || 'Usuario';
            idUser.textContent = `${item.id_interaccion} · ${alias} (${item.id_usuario || '-'})`;

            const sentVal = Number(item.sentimiento ?? 0);
            const sentPill = document.createElement('span');
            sentPill.className = `sent-pill ${
                sentVal > 0 ? 'sent-pos' : sentVal < 0 ? 'sent-neg' : 'sent-neu'
            }`;
            sentPill.textContent = `${sentVal > 0 ? '+' : ''}${sentVal.toFixed(2)}`;

            top.appendChild(idUser);
            top.appendChild(sentPill);

            const textDiv = document.createElement('div');
            textDiv.className = 'interaction-text';
            textDiv.textContent = item.texto || '(Interacción sin texto)';

            const metaRow = document.createElement('div');
            metaRow.className = 'interaction-meta-row';

            const pillCanal = document.createElement('span');
            pillCanal.className = 'meta-pill';
            pillCanal.textContent = item.canal || '-';
            metaRow.appendChild(pillCanal);

            const pillTema = document.createElement('span');
            pillTema.className = 'meta-pill';
            pillTema.textContent = formatearEtiqueta(item.tema);
            metaRow.appendChild(pillTema);

            const pillTipo = document.createElement('span');
            pillTipo.className = 'meta-pill';
            pillTipo.textContent = formatearEtiqueta(item.tipo);
            metaRow.appendChild(pillTipo);

            const etiquetas = Array.isArray(item.etiquetas) ? item.etiquetas : [];
            for (const tag of etiquetas) {
                const chip = document.createElement('span');
                chip.className = 'tag-chip';
                chip.textContent = `#${tag}`;
                metaRow.appendChild(chip);
            }

            li.appendChild(top);
            li.appendChild(textDiv);
            li.appendChild(metaRow);

            rtListaInteracciones.appendChild(li);
        }
    }

    function procesarMetricasTiempoReal(metricas) {
        if (!metricas) return;
        ultimasMetricasCache = metricas;
        actualizarKPIsTiempoReal(metricas);
        actualizarGraficasTiempoReal(metricas);
        actualizarTopEtiquetasTiempoReal(metricas);
        actualizarSemaforoTiempoReal(metricas);
        actualizarMatrizCalorTiempoReal(metricas);
        actualizarFeedTiempoReal(metricas);
    }

    function conectarWebSockets(token) {
        if (!window.io) return;

        socket = io({
            auth: {
                token
            }
        });

        socket.on('connect', () => {
            actualizarIndicadorSocket(true);
        });

        socket.on('disconnect', () => {
            actualizarIndicadorSocket(false);
        });

        socket.on('connect_error', () => {
            actualizarIndicadorSocket(false);
        });

        socket.on('metricas:iniciales', (metricas) => {
            procesarMetricasTiempoReal(metricas);
        });

        socket.on('interacciones:actualizadas', (payload) => {
            if (payload && payload.metricas) {
                procesarMetricasTiempoReal(payload.metricas);
            }
            if (payload && payload.accion) {
                mostrarToastTiempoReal(payload.accion, payload.id_interaccion);
            }
        });
    }

    // =========================================================================
    // BLOQUE B: ANALÍTICA HISTÓRICA CONSOLIDADA (API REST — TIDB CLOUD)
    // =========================================================================

    async function fetchProtegido(url, token) {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (res.status === 401 || res.status === 403) {
            expulsarAlLogin();
            throw new Error('Sesión expirada o no autorizada.');
        }

        if (!res.ok) {
            throw new Error(`Error HTTP ${res.status} al consultar ${url}`);
        }

        return res.json();
    }

    function renderizarKPIsHistoricos(resumen) {
        const total = Number(resumen.total_usuarios || 0);
        const activos = Number(resumen.activos || 0);
        const enRiesgo = Number(resumen.en_riesgo || 0);
        const inactivos = Number(resumen.inactivos || 0);
        const artistas = Number(resumen.total_artistas || 0);
        const anonimizados = Number(resumen.usuarios_anonimizados || 0);
        const sentGlobal = Number(resumen.sentimiento_promedio_global || 0);
        const mensajes30d = Number(resumen.mensajes_30d_total || 0);

        kpiTotalUsuarios.textContent = formatearNumero(total);
        kpiMensajesSub.textContent = `${formatearNumero(mensajes30d)} mensajes en últimos 30d`;

        kpiUsuariosActivos.textContent = formatearNumero(activos);
        const pctActivos = total > 0 ? ((activos / total) * 100).toFixed(1) : '0.0';
        kpiActivosPct.textContent = `${pctActivos}% del padrón total`;

        kpiUsuariosRiesgo.textContent = formatearNumero(enRiesgo);
        kpiInactivosSub.textContent = `Inactivos acumulados: ${formatearNumero(inactivos)}`;

        kpiTotalArtistas.textContent = formatearNumero(artistas);
        kpiSentimientoGlobalSub.textContent = `Sentimiento histórico: ${sentGlobal >= 0 ? '+' : ''}${sentGlobal.toFixed(3)}`;

        kpiUsuariosAnonimizados.textContent = formatearNumero(anonimizados);

        privacyMapNote.innerHTML =
            `<strong>Aviso de Privacidad Activo:</strong> Los <strong>${formatearNumero(anonimizados)} usuarios</strong> ` +
            `con <code>consentimiento_datos = 'no'</code> fueron excluidos estrictamente de este mapa geográfico por privacidad.`;

        if (resumen.bitacora_etl && resumen.bitacora_etl.fecha_ejecucion) {
            const fechaEtl = new Date(resumen.bitacora_etl.fecha_ejecucion);
            etlMetaBadge.textContent = `ETL ${fechaEtl.toLocaleDateString('es-MX')} · ACEPTADAS: ${formatearNumero(resumen.bitacora_etl.interacciones_aceptadas)}`;
        } else {
            etlMetaBadge.textContent = 'TIDB CLOUD CONECTADO';
        }
    }

    function renderizarGraficasHistoricas(distribucion) {
        const t = obtenerTokensTema();

        // 1. Gráfica de Dona: Estatus
        const estatusItems = Array.isArray(distribucion.estatus) ? distribucion.estatus : [];
        const nombresEstatus = {
            activo: 'Activo',
            en_riesgo: 'En riesgo',
            inactivo: 'Inactivo'
        };
        const coloresEstatus = {
            activo: '#0F766E',
            en_riesgo: '#D97706',
            inactivo: '#64748B'
        };

        const ctxEstatus = document.getElementById('chartHistEstatus').getContext('2d');
        if (chartEstatus) chartEstatus.destroy();
        chartEstatus = new Chart(ctxEstatus, {
            type: 'doughnut',
            data: {
                labels: estatusItems.map((i) => nombresEstatus[i.estatus] || i.estatus),
                datasets: [
                    {
                        data: estatusItems.map((i) => Number(i.total || 0)),
                        backgroundColor: estatusItems.map((i) => coloresEstatus[i.estatus] || '#64748B'),
                        borderColor: t.surfaceBorder,
                        borderWidth: 2,
                        hoverOffset: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '64%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: t.textColor,
                            padding: 14,
                            usePointStyle: true
                        }
                    }
                }
            }
        });

        // 2. Gráfica de Barras: Plataforma Principal
        const platItems = Array.isArray(distribucion.plataforma) ? distribucion.plataforma : [];
        const ctxPlat = document.getElementById('chartHistPlataformas').getContext('2d');
        if (chartPlataformas) chartPlataformas.destroy();
        chartPlataformas = new Chart(ctxPlat, {
            type: 'bar',
            data: {
                labels: platItems.map((i) => i.plataforma),
                datasets: [
                    {
                        label: 'Usuarios',
                        data: platItems.map((i) => Number(i.total || 0)),
                        backgroundColor: t.accentPrimary,
                        borderColor: t.accentPrimary,
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: t.textColor },
                        grid: { color: t.gridColor }
                    },
                    x: {
                        ticks: { color: t.textColor },
                        grid: { display: false }
                    }
                }
            }
        });

        // 3. Gráfica de Barras Horizontales: Interés Principal
        const interesItems = Array.isArray(distribucion.interes) ? distribucion.interes : [];
        const ctxInteres = document.getElementById('chartHistIntereses').getContext('2d');
        if (chartIntereses) chartIntereses.destroy();
        chartIntereses = new Chart(ctxInteres, {
            type: 'bar',
            data: {
                labels: interesItems.map((i) => i.interes),
                datasets: [
                    {
                        label: 'Usuarios',
                        data: interesItems.map((i) => Number(i.total || 0)),
                        backgroundColor: t.accentSecondary,
                        borderColor: t.accentSecondary,
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: t.textColor },
                        grid: { color: t.gridColor }
                    },
                    y: {
                        ticks: { color: t.textColor },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    function renderizarMapaCalor(mapaData) {
        const puntos = Array.isArray(mapaData.puntos) ? mapaData.puntos : [];
        mapPointsBadge.textContent = `${formatearNumero(puntos.length)} UBICACIONES CON CONSENTIMIENTO`;

        if (!leafletMap) {
            leafletMap = L.map('heatmapUsuarios', {
                center: [15.5, -90.0],
                zoom: 4,
                scrollWheelZoom: true
            });

            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(leafletMap);
        }

        const coordenadasHeat = puntos.map((p) => [
            Number(p.latitud),
            Number(p.longitud),
            0.85
        ]);

        if (heatLayer) {
            leafletMap.removeLayer(heatLayer);
        }

        heatLayer = L.heatLayer(coordenadasHeat, {
            radius: 24,
            blur: 18,
            maxZoom: 10,
            minOpacity: 0.42,
            gradient: {
                0.25: '#0F766E',
                0.55: '#D97706',
                0.85: '#C85A32',
                1.0: '#BE123C'
            }
        }).addTo(leafletMap);

        if (coordenadasHeat.length > 0) {
            const bounds = L.latLngBounds(coordenadasHeat.map((c) => [c[0], c[1]]));
            leafletMap.fitBounds(bounds, { padding: [32, 32], maxZoom: 6 });
        }

        setTimeout(() => {
            leafletMap.invalidateSize();
        }, 150);
    }

    async function cargarAnaliticaHistorica(token) {
        histErrorBanner.classList.remove('visible');
        histErrorBanner.textContent = '';

        try {
            const [resumen, distribucion, mapa] = await Promise.all([
                fetchProtegido('/api/historicos/resumen', token),
                fetchProtegido('/api/historicos/distribucion', token),
                fetchProtegido('/api/historicos/mapa', token)
            ]);

            renderizarKPIsHistoricos(resumen);
            renderizarGraficasHistoricas(distribucion);
            renderizarMapaCalor(mapa);
        } catch (error) {
            histErrorBanner.textContent =
                `No fue posible cargar la analítica histórica desde TiDB Cloud: ${error.message}`;
            histErrorBanner.classList.add('visible');
        }
    }

    async function inicializarDashboard() {
        const token = localStorage.getItem('c360_token');

        if (!token) {
            expulsarAlLogin();
            return;
        }

        try {
            const verifyRes = await fetch('/api/auth/verify', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!verifyRes.ok) {
                expulsarAlLogin();
                return;
            }

            const verifyData = await verifyRes.json();
            if (!verifyData.autenticado || !verifyData.admin) {
                expulsarAlLogin();
                return;
            }

            adminNombreEl.textContent = verifyData.admin.nombre;
            adminEmailEl.textContent = verifyData.admin.email;

            loadingScreen.style.display = 'none';
            protectedApp.style.display = 'block';

            iniciarObservadorNavegacion();
            conectarWebSockets(token);
            await cargarAnaliticaHistorica(token);
        } catch (_) {
            expulsarAlLogin();
        }
    }

    btnLogout.addEventListener('click', async () => {
        btnLogout.disabled = true;
        btnLogout.textContent = 'Cerrando...';

        const token = localStorage.getItem('c360_token');

        try {
            if (token) {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            }
        } catch (_) {
            // Limpiar sesión local incluso ante fallo de red
        } finally {
            expulsarAlLogin();
        }
    });

    inicializarDashboard();
})();
