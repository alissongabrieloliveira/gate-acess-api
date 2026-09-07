const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const { UPLOADS_ROOT } = require('./middlewares/upload');
const authRoutes = require('./modules/auth/auth.routes');
const citiesRoutes = require('./modules/cities/cities.routes');
const companiesRoutes = require('./modules/companies/companies.routes');
const usersRoutes = require('./modules/users/users.routes');
const peopleRoutes = require('./modules/people/people.routes');
const vehiclesRoutes = require('./modules/vehicles/vehicles.routes');
const gatesRoutes = require('./modules/gates/gates.routes');
const sectorsRoutes = require('./modules/sectors/sectors.routes');
const accessLogsRoutes = require('./modules/access-logs/access-logs.routes');
const fleetLogsRoutes = require('./modules/fleet-logs/fleet-logs.routes');
const auditLogsRoutes = require('./modules/audit-logs/audit-logs.routes');
const loginLogsRoutes = require('./modules/login-logs/login-logs.routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Servidas sem autenticação (URLs geradas pelo próprio servidor, nunca
// adivinháveis o suficiente pra depender só disso, mas simples o bastante
// pra esse projeto — ver decisão documentada na memória do projeto).
app.use('/uploads', express.static(UPLOADS_ROOT));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/cities', citiesRoutes);
app.use('/api/v1/companies', companiesRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/people', peopleRoutes);
app.use('/api/v1/vehicles', vehiclesRoutes);
app.use('/api/v1/gates', gatesRoutes);
app.use('/api/v1/sectors', sectorsRoutes);
app.use('/api/v1/access-logs', accessLogsRoutes);
app.use('/api/v1/fleet-logs', fleetLogsRoutes);
app.use('/api/v1/audit-logs', auditLogsRoutes);
app.use('/api/v1/login-logs', loginLogsRoutes);

app.use(errorHandler);

module.exports = app;
