import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; wallet: string };
    user: { sub: string; wallet: string };
  }
}

