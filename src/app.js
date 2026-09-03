const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const authRoutes = require('./modules/auth/auth.routes');
const companiesRoutes = require('./modules/companies/companies.routes');
const usersRoutes = require('./modules/users/users.routes');
const peopleRoutes = require('./modules/people/people.routes');
const vehiclesRoutes = require('./modules/vehicles/vehicles.routes');
const gatesRoutes = require('./modules/gates/gates.routes');
const sectorsRoutes = require('./modules/sectors/sectors.routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/companies', companiesRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/people', peopleRoutes);
app.use('/api/v1/vehicles', vehiclesRoutes);
app.use('/api/v1/gates', gatesRoutes);
app.use('/api/v1/sectors', sectorsRoutes);

app.use(errorHandler);

module.exports = app;
