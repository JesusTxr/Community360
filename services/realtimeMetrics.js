const db = require('../config/firebase');

const COLLECTION = 'interacciones';

function ordenarConteosDesc(mapaConteos) {
    return Object.fromEntries(
        Object.entries(mapaConteos).sort((a, b) => b[1] - a[1])
    );
}

async function calcularMetricasTiempoReal() {
    const snapshot = await db.collection(COLLECTION).get();

    const interacciones = snapshot.docs.map((doc) => {
        const data = doc.data();
        const sinConsentimiento =
            String(data.usuario_snapshot?.consentimiento_datos || '').toLowerCase() === 'no';

        return {
            id_interaccion: doc.id,
            ...data,
            pais: sinConsentimiento ? null : (data.pais ?? null),
            estado: sinConsentimiento ? null : (data.estado ?? null),
            ciudad: sinConsentimiento ? null : (data.ciudad ?? null)
        };
    });

    const total_interacciones = interacciones.length;
    let sumaSentimiento = 0;
    let interaccionesPositivas = 0;
    let sumaReacciones = 0;

    // Conteos para semáforo de sentimiento
    let semPositivas = 0;
    let semNeutras = 0;
    let semNegativas = 0;

    const conteoCanal = {};
    const conteoTema = {};
    const conteoTipo = {};
    const conteoEtiquetas = {};
    const matrizCruda = {};

    for (const item of interacciones) {
        const sent = Number(item.sentimiento);
        if (!Number.isNaN(sent) && Number.isFinite(sent)) {
            sumaSentimiento += sent;
            if (sent > 0) {
                interaccionesPositivas++;
            }

            if (sent > 0.1) {
                semPositivas++;
            } else if (sent < -0.1) {
                semNegativas++;
            } else {
                semNeutras++;
            }
        } else {
            semNeutras++;
        }

        const reacc = Number(item.reacciones_recibidas);
        if (!Number.isNaN(reacc) && Number.isFinite(reacc) && reacc > 0) {
            sumaReacciones += reacc;
        }

        const canal = item.canal ? String(item.canal).trim() : 'Sin especificar';
        const tema = item.tema ? String(item.tema).trim() : 'Sin especificar';
        const tipo = item.tipo ? String(item.tipo).trim() : 'Sin especificar';

        conteoCanal[canal] = (conteoCanal[canal] || 0) + 1;
        conteoTema[tema] = (conteoTema[tema] || 0) + 1;
        conteoTipo[tipo] = (conteoTipo[tipo] || 0) + 1;

        if (!matrizCruda[canal]) {
            matrizCruda[canal] = {};
        }
        matrizCruda[canal][tipo] = (matrizCruda[canal][tipo] || 0) + 1;

        if (Array.isArray(item.etiquetas)) {
            for (const rawTag of item.etiquetas) {
                const tag = String(rawTag || '').trim().toLowerCase();
                if (tag) {
                    conteoEtiquetas[tag] = (conteoEtiquetas[tag] || 0) + 1;
                }
            }
        }
    }

    const sentimiento_promedio =
        total_interacciones > 0
            ? Number((sumaSentimiento / total_interacciones).toFixed(3))
            : 0;

    const tasa_positividad =
        total_interacciones > 0
            ? Number(((interaccionesPositivas / total_interacciones) * 100).toFixed(1))
            : 0;

    const promedio_reacciones =
        total_interacciones > 0
            ? Number((sumaReacciones / total_interacciones).toFixed(2))
            : 0;

    const top_etiquetas = Object.entries(conteoEtiquetas)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([etiqueta, conteo]) => ({ etiqueta, conteo }));

    const calcularPct = (conteo) =>
        total_interacciones > 0
            ? Number(((conteo / total_interacciones) * 100).toFixed(1))
            : 0;

    const semaforo_sentimiento = {
        positivas: {
            conteo: semPositivas,
            porcentaje: calcularPct(semPositivas)
        },
        neutras: {
            conteo: semNeutras,
            porcentaje: calcularPct(semNeutras)
        },
        negativas: {
            conteo: semNegativas,
            porcentaje: calcularPct(semNegativas)
        }
    };

    const por_canal = ordenarConteosDesc(conteoCanal);
    const por_tema = ordenarConteosDesc(conteoTema);
    const por_tipo = ordenarConteosDesc(conteoTipo);

    // Construir matriz ordenada (canales en filas x tipos en columnas)
    const canalesOrdenados = Object.keys(por_canal);
    const tiposOrdenados = Object.keys(por_tipo);
    const matriz_canal_tipo = {};

    for (const canal of canalesOrdenados) {
        matriz_canal_tipo[canal] = {};
        for (const tipo of tiposOrdenados) {
            matriz_canal_tipo[canal][tipo] = matrizCruda[canal]?.[tipo] || 0;
        }
    }

    // Ordenar de más reciente a más antigua por timestamp
    interacciones.sort((a, b) => {
        const tsA = Date.parse(a.timestamp || '') || 0;
        const tsB = Date.parse(b.timestamp || '') || 0;
        return tsB - tsA;
    });

    const ultimas_interacciones = interacciones.slice(0, 10);

    return {
        total_interacciones,
        sentimiento_promedio,
        tasa_positividad,
        promedio_reacciones,
        top_etiquetas,
        semaforo_sentimiento,
        por_canal,
        por_tema,
        por_tipo,
        matriz_canal_tipo,
        ultimas_interacciones,
        actualizado_en: new Date().toISOString()
    };
}

module.exports = { calcularMetricasTiempoReal };
