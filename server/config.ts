import { RateLimiterConfig } from "./accessControl.ts";

interface OctopussConfig {
	routesDir: string;
	proxy?: {
		forwardedIPHeader?: string;
		requestIdHeader?: string;
	},
	rateLimit?: RateLimiterConfig;
	handleCORS: boolean;
	allowedOrigings?: string[];
	exposeRequestID: boolean;
}
