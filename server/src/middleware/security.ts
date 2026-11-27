import type { FastifyInstance } from 'fastify';

/**
 * Apply security-related HTTP headers to all responses.
 *
 * @param app - The Fastify application instance
 */
export const applySecurity = (app: FastifyInstance): void => {
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self' ws: wss:;",
    );
    reply.removeHeader('X-Powered-By');
  });
};
