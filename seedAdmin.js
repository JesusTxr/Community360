require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./config/db');

async function seedAdmin() {
    const administradores = [
        {
            nombre: 'Jesus Torres',
            email: 'admin@community360.com',
            passwordPlano: 'Admin360!'
        },
        {
            nombre: 'Lizandro Reyes',
            email: 'lizandro.reyes@utmetropolitana.edu.mx',
            passwordPlano: 'lizandr0_reye$'
        }
    ];

    const sqlUpsert = `
        INSERT INTO administradores (nombre, email, password_hash)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
            nombre = VALUES(nombre),
            password_hash = VALUES(password_hash)
    `;

    try {
        for (const admin of administradores) {
            const passwordHash = await bcrypt.hash(admin.passwordPlano, 10);
            await pool.execute(sqlUpsert, [admin.nombre, admin.email, passwordHash]);
            console.log(`[SEED] Administrador procesado (insert/update): ${admin.email}`);
        }

        const [rows] = await pool.execute(
            `SELECT id_admin, nombre, email, password_hash, creado_en
             FROM administradores
             WHERE email IN (?, ?)
             ORDER BY id_admin ASC`,
            [administradores[0].email, administradores[1].email]
        );

        console.log('\n[VERIFICACIÓN TiDB Cloud - Tabla administradores]:');
        console.log(rows);
    } catch (error) {
        console.error('[ERROR SEED ADMIN]:', error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

seedAdmin();
