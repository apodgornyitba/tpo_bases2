import http from 'http';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

function request(path, opts = {}) {
    const url = new URL(path, BASE);
    const method = opts.method || 'GET';
    const headers = opts.headers || { 'Content-Type': 'application/json' };
    const body = opts.body ? JSON.stringify(opts.body) : undefined;

    return new Promise((resolve, reject) => {
        const req = http.request(url, { method, headers }, res => {
            let data = '';
            res.on('data', c => data += c.toString());
            res.on('end', () => {
                const contentType = res.headers['content-type'] || '';
                let parsed = data;
                if (contentType.includes('application/json') && data) {
                    try { parsed = JSON.parse(data); } catch (e) { /* keep raw */ }
                }
                resolve({ status: res.statusCode, body: parsed, headers: res.headers });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function run() {
    const failures = [];

    function findDuplicates(arr, keyFn) {
        const seen = new Map();
        for (const it of arr) {
            const k = keyFn(it);
            const prev = seen.get(k) ?? 0;
            seen.set(k, prev + 1);
        }
        const dups = [];
        for (const [k, v] of seen) if (v > 1) dups.push({ key: k, count: v });
        return dups;
    }

    const checks = [
        { name: 'API health', fn: async () => {
            const r = await request('/health');
            if (r.status !== 200) throw new Error(`health status ${r.status}`);
        }},
        { name: 'Neo4j health', fn: async () => {
            const r = await request('/neo4j/health');
            if (r.status !== 200 || !r.body || r.body.ok !== true) throw new Error(`neo4j health fail ${r.status}`);
        }},
        { name: 'GET vehiculos asegurados', fn: async () => {
            const r = await request('/vehiculos/asegurados');
            if (r.status !== 200) throw new Error('/vehiculos/asegurados returned ' + r.status);
            if (!Array.isArray(r.body)) throw new Error('expected array');
        }},
        { name: 'GET clientes sin polizas activas', fn: async () => {
            const r = await request('/clientes/sin-polizas-activas');
            if (r.status !== 200) throw new Error('/clientes/sin-polizas-activas returned ' + r.status);
        }},
        { name: 'GET vehiculos asegurados - no duplicate patentes', fn: async () => {
            const r = await request('/vehiculos/asegurados');
            if (r.status !== 200) throw new Error('/vehiculos/asegurados returned ' + r.status);
            if (!Array.isArray(r.body)) throw new Error('expected array');
            const d = findDuplicates(r.body, it => it.patente ?? `${it.marca}|${it.modelo}`);
            if (d.length) throw new Error('duplicate patentes found: ' + JSON.stringify(d.slice(0,5)));
        }},
        { name: 'GET agentes activos con cant polizas - no duplicate agente ids', fn: async () => {
            const r = await request('/agentes/activos-con-cant-polizas');
            if (r.status !== 200) throw new Error('/agentes/activos-con-cant-polizas returned ' + r.status);
            if (!Array.isArray(r.body)) throw new Error('expected array');
            const d = findDuplicates(r.body, it => String(it.id_agente ?? it.id ?? '')); 
            if (d.length) throw new Error('duplicate agentes found: ' + JSON.stringify(d.slice(0,5)));
        }},
        { name: 'GET polizas vencidas con cliente - no duplicate nro_poliza', fn: async () => {
            const r = await request('/polizas/vencidas-con-cliente');
            if (r.status !== 200) throw new Error('/polizas/vencidas-con-cliente returned ' + r.status);
            if (!Array.isArray(r.body)) throw new Error('expected array');
            const d = findDuplicates(r.body, it => it.nro_poliza ?? '');
            if (d.length) throw new Error('duplicate polizas found: ' + JSON.stringify(d.slice(0,5)));
        }},
        { name: 'GET clientes top cobertura - no duplicate clientes', fn: async () => {
            const r = await request('/clientes/top-cobertura');
            if (r.status !== 200) throw new Error('/clientes/top-cobertura returned ' + r.status);
            if (!Array.isArray(r.body)) throw new Error('expected array');
            const d = findDuplicates(r.body, it => String(it.id_cliente ?? it.id ?? ''));
            if (d.length) throw new Error('duplicate clientes found: ' + JSON.stringify(d.slice(0,5)));
        }},
        { name: 'GET siniestros accidente ultimo anio (neo4j) - unique siniestro_id', fn: async () => {
            const r = await request('/siniestros/accidente-ultimo-anio');
            if (r.status !== 200) throw new Error('/siniestros/accidente-ultimo-anio returned ' + r.status);
            if (!Array.isArray(r.body)) throw new Error('expected array');
            const d = findDuplicates(r.body, it => String(it.siniestro_id ?? it.id ?? ''));
            if (d.length) throw new Error('duplicate siniestros found: ' + JSON.stringify(d.slice(0,5)));
        }},
        { name: 'GET polizas activas ordenadas - pagination sanity', fn: async () => {
            const r = await request('/polizas/activas-ordenadas?page=1&pageSize=10');
            if (r.status !== 200) throw new Error('/polizas/activas-ordenadas returned ' + r.status);
            if (!r.body || typeof r.body !== 'object') throw new Error('expected object with page metadata');
            if (!Array.isArray(r.body.items)) throw new Error('expected items array');
            if (r.body.items.length > 10) throw new Error('pageSize exceeded');
        }},
        { name: 'GET polizas suspendidas con estado cliente - no duplicate poliza nro', fn: async () => {
            const r = await request('/polizas/suspendidas-con-estado-cliente');
            if (r.status !== 200) throw new Error('/polizas/suspendidas-con-estado-cliente returned ' + r.status);
            if (!Array.isArray(r.body)) throw new Error('expected array');
            const d = findDuplicates(r.body, it => it.nro_poliza ?? '');
            if (d.length) throw new Error('duplicate suspended polizas: ' + JSON.stringify(d.slice(0,5)));
        }},
        { name: 'GET clientes con multiples vehiculos - shape check', fn: async () => {
            const r = await request('/clientes/con-multiples-vehiculos');
            if (r.status !== 200) throw new Error('/clientes/con-multiples-vehiculos returned ' + r.status);
            if (!Array.isArray(r.body)) throw new Error('expected array');
        }},
        { name: 'GET agentes cant siniestros - counts valid and unique ids', fn: async () => {
            const r = await request('/agentes/cant-siniestros');
            if (r.status !== 200) throw new Error('/agentes/cant-siniestros returned ' + r.status);
            if (!Array.isArray(r.body)) throw new Error('expected array');
            const d = findDuplicates(r.body, it => String(it.id_agente ?? ''));
            if (d.length) throw new Error('duplicate agentes in siniestros count: ' + JSON.stringify(d.slice(0,5)));
            for (const it of r.body) {
                const cnt = it.cant_siniestros;
                if (cnt == null) throw new Error('missing cant_siniestros for ' + JSON.stringify(it));
            }
        }},
        { name: 'POST polizas (validation)', fn: async () => {
            const payload = { nro_poliza: 'TEST999', id_cliente: 9999, tipo: 'Auto', fecha_inicio: '2025-01-01', fecha_fin: '2026-01-01', prima_mensual: 1000, cobertura_total: 100000, id_agente: 1, estado: 'Activa' };
            const r = await request('/polizas', { method: 'POST', body: payload });
            if (r.status === 201) return;
            if (r.status === 400 && r.body && (r.body.error === 'agente_inexistente' || r.body.error === 'cliente_inexistente')) return;
            throw new Error('/polizas unexpected response ' + r.status + ' ' + JSON.stringify(r.body));
        }},
        { name: 'POST siniestros create', fn: async () => {
            const payload = { id_siniestro: 99999, nro_poliza: 'POL1001', fecha: '2025-03-20', tipo: 'Accidente', monto_estimado: 1000, descripcion: 'Test', estado: 'Abierto' };
            const r = await request('/siniestros', { method: 'POST', body: payload });
            if (![200,201].includes(r.status)) throw new Error('/siniestros create failed ' + r.status + ' ' + JSON.stringify(r.body));
        }}
    ];

    for (const c of checks) {
        try {
            await c.fn();
            console.log(`✔ ${c.name}`);
        } catch (e) {
            console.error(`✖ ${c.name} -> ${e.message}`);
            failures.push({ name: c.name, error: e.message });
        }
    }

    if (failures.length) {
        console.error('\nSummary: FAIL', failures);
        process.exit(2);
    }
    console.log('\nSummary: OK');
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
