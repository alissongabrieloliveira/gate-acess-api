const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const env = require('./config/env');
const AppError = require('./utils/AppError');
const { initSentry, Sentry } = require('./utils/sentry');
const requestLogger = require('./middlewares/requestLogger');
const { apiLimiter } = require('./middlewares/rateLimit');
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
const healthRoutes = require('./modules/health/health.routes');
const errorHandler = require('./middlewares/errorHandler');

initSentry();

const app = express();

// Railway (e provedores de deploy parecidos) coloca a API atrás de um proxy
// reverso — sem isso, o Express ignora o cabeçalho `X-Forwarded-For` e
// `req.ip` resolve pro endereço interno do proxy, o MESMO pra toda
// requisição. Efeito real (achado em produção): os limitadores por IP de
// `middlewares/rateLimit.js` (apiLimiter, loginIpLimiter, refreshLimiter)
// acabam compartilhando uma única cota entre todos os usuários, em vez de
// limitar por origem de verdade — e o express-rate-limit recusa gerar a
// chave nesse cenário (`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`). `1` confia só
// no primeiro hop (o proxy do Railway), não em qualquer proxy encadeado
// informado pelo próprio cliente — mais seguro que `true` (confiaria em
// qualquer quantidade de hops que o cliente alegasse).
app.set('trust proxy', 1);

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

// Limite geral em toda a API — os endpoints de auth ainda ganham limites
// próprios mais rígidos (ver auth.routes.js), aplicados em série com este.
app.use('/api/v1', apiLimiter);

app.use('/api/v1/health', healthRoutes);
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

// Precisa vir depois de todas as rotas e antes do errorHandler (ordem
// exigida pela própria Sentry). `shouldHandleError` filtra pra só capturar
// exceptions de verdade: AppError e MulterError já viram respostas 4xx
// controladas pelo errorHandler abaixo, não são "erro" no sentido de
// alerta — só o catch-all 500 é reportado.
Sentry.setupExpressErrorHandler(app, {
  shouldHandleError(err) {
    return !(err instanceof AppError) && !(err instanceof multer.MulterError);
  },
});

app.use(errorHandler);

module.exports = app;
