import { type StaticHandler, findAllRoutes, loadRoutes } from "./routeHandlers.ts";
import { JSONResponse } from "./api.ts";
import { OriginChecker, RateLimiter, type RateLimiterConfig } from "./accessControl.ts";
import { ServiceConsole } from "./console.ts";

interface OctopussOptions {
	routesDir: string;
	proxy?: {
		forwardedIPHeader?: string;
		requestIdHeader?: string;
	},
	rateLimit?: RateLimiterConfig;
	handleCORS?: boolean;
	allowedOrigings?: string[];
	exposeRequestID?: boolean;
};

interface StartServerOptions {
	serve?: Deno.ServeOptions | Deno.ServeTlsOptions;
	octo?: OctopussOptions;
	handlers?: Record<string, StaticHandler>;
};

export const startServer = async (opts?: StartServerOptions) => {

	const searchDir = opts?.octo?.routesDir || 'src/routes';

	console.log(`%cIndexing functions in ${searchDir}...`, 'color: yellow');

	const handlers = await findAllRoutes(searchDir);
	if (!handlers.entries.length) throw new Error(`Failed to load route functions: no modules found in "${searchDir}"`);

	const routesPool = await loadRoutes(handlers);

	const globalRateLimiter: RateLimiter | null = opts?.octo?.rateLimit ? new RateLimiter(opts.octo.rateLimit) : null;
	const globalOriginChecker: OriginChecker | null = opts?.octo?.allowedOrigings?.length ? new OriginChecker(opts.octo.allowedOrigings) : null;

	const httpRequestHandler: Deno.ServeHandler = async (request, info) => {

		const requestOrigin = request.headers.get('origin');
		const requestIP = (opts?.octo?.proxy?.forwardedIPHeader ? request.headers.get(opts.octo.proxy.forwardedIPHeader) : undefined) || info.remoteAddr.hostname;
		const requestID = (opts?.octo?.proxy?.requestIdHeader ? request.headers.get(opts.octo.proxy.requestIdHeader) : undefined) || 'test';
		let allowedOrigin: string | null = null;
		let exposeRequestID = false;
		let requestDisplayUrl = '/';

		const console = new ServiceConsole(requestID);

		const middleware = await (async () => {

			const { pathname, search } = new URL(request.url);
			requestDisplayUrl = pathname + search;

			// find route function
			let routectx = routesPool[pathname];

			// match route function
			if (!routectx) {
				const pathComponents = pathname.slice(1).split('/');
				for (let idx = pathComponents.length - 1; idx >= 0; idx--) {
	
					const nextRoute = '/' + pathComponents.slice(0, idx).join('/');
					const nextCtx = routesPool[nextRoute];
	
					if (nextCtx?.url.expand) {
						routectx = nextCtx;
						break;
					}
				}
			}
	
			//	go cry in the corned if it's not found
			if (!routectx) {
				return new JSONResponse({
					error_text: 'route not found'
				}, { status: 404 }).toResponse();
			}

			//	check request origin
			const originChecker = routectx.originChecker !== null ? (routectx.originChecker || globalOriginChecker) : null;
			if (originChecker) {
				if (!requestOrigin) {
					return new JSONResponse({
						error_text: 'client not verified'
					}, { status: 403 }).toResponse();
				} else if (!originChecker.check(requestOrigin)) {
					console.log('Origin not allowed:', requestOrigin);
					return new JSONResponse({
						error_text: 'client not verified'
					}, { status: 403 }).toResponse();
				}
			}

			//	check rate limiter
			const rateLimiter = routectx.rateLimiter !== null ? (routectx.rateLimiter || globalRateLimiter) : null;
			if (rateLimiter) {
				const rateCheck = rateLimiter.check({ ip: requestIP });
				if (!rateCheck.ok) {
					console.log(`Too many requests (${rateCheck.requests}). Wait for ${rateCheck.reset}s`);
					return new JSONResponse({
						error_text: 'too many requests'
					}, { status: 429 }).toResponse();
				}
			}

			//	respond to CORS preflixgt
			if (request.method == 'OPTIONS' && opts?.octo?.handleCORS !== false) {

				const requestedCorsHeaders = request.headers.get('Access-Control-Request-Headers');
				const defaultCorsHeaders = 'Origin, X-Requested-With, Content-Type, Accept';

				const requestedCorsMethod = request.headers.get('Access-Control-Request-Method');
				const defaultCorsMethods = 'GET, POST, PUT, OPTIONS, DELETE';

				if (!allowedOrigin) allowedOrigin = '*';

				return new JSONResponse(null, {
					status: 204,
					headers: {
						'Access-Control-Allow-Methods': requestedCorsMethod || defaultCorsMethods,
						//'Access-Control-Allow-Origin': allowedOrigin,
						//	this one is gonna be appended later
						'Access-Control-Allow-Headers': requestedCorsHeaders || defaultCorsHeaders,
						'Access-Control-Max-Age': '3600',
						'Access-Control-Allow-Credentials': 'true'
					}
				}).toResponse();
			}

			//	expose request id
			if (opts?.octo?.exposeRequestID) exposeRequestID = true;

			//	execute route function
			try {
				const handlerResponse = await routectx.handler(request, { console, requestID, requestIP });
				return handlerResponse instanceof JSONResponse ? handlerResponse.toResponse() : handlerResponse;
			} catch (error) {
				console.error('Octo middleware error:', (error as Error).message || error);
				return new JSONResponse({
					error_text: 'unhandled middleware error'
				}, { status: 500 }).toResponse();
			}

		})();

		//	add some headers so the shit always works
		middleware.headers.set('x-powered-by', 'octopuss');
		if (allowedOrigin) middleware.headers.set('Access-Control-Allow-Origin', allowedOrigin);
		if (exposeRequestID) middleware.headers.set('x-request-id', requestID);

		//	log for, you know, reasons
		console.log(`(${requestIP}) ${request.method} "${requestDisplayUrl}" --> ${middleware.status}`);

		return middleware;
	};

	if (!opts?.serve) {
		Deno.serve(httpRequestHandler);
		return
	}

	Deno.serve(opts?.serve, httpRequestHandler);
};
