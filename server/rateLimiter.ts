
export interface RateLimiterConfig {
	period: number,
	requests: number
};

interface ActivityData {
	total: number;
	last: number;
};

interface CheckRateProps {
	ip: string;
};

export class RateLimiter {

	config: RateLimiterConfig;
	activity: Map<string, ActivityData>;

	static defaultConfig: RateLimiterConfig = {
		period: 3600,
		requests: 25
	};

	constructor(config?: Partial<RateLimiterConfig>) {
		this.activity = new Map();
		this.config = RateLimiter.defaultConfig;
		if (config) this.setConfig(config);
	}

	setConfig(config: Partial<RateLimiterConfig>) {
		for (let key in config) {
			if (typeof RateLimiter.defaultConfig[key as keyof RateLimiterConfig] === typeof config[key as keyof RateLimiterConfig]) {
				this.config[key as keyof RateLimiterConfig] = config[key as keyof typeof config] as RateLimiterConfig[keyof RateLimiterConfig];
			}
		}
	}

	check(props: CheckRateProps) {

		const clientActivity = this.activity.get(props.ip);
		if (!clientActivity) {
			this.activity.set(props.ip, {
				total: 1,
				last: new Date().getTime()
			});
			return {
				ok: true,
				requests: 0,
				reset: this.config.period
			};
		}

		const timeDelta = Math.floor((new Date().getTime() - new Date(clientActivity.last).getTime()) / 1000);
		const resetTime = timeDelta > 0 ? this.config.period - timeDelta : this.config.period;

		clientActivity.total++;
		clientActivity.last = new Date().getTime();

		if (timeDelta >= this.config.period) {
			if (clientActivity.total > 0)
			this.activity.delete(props.ip);
			return {
				ok: true,
				requests: clientActivity.total,
				reset: resetTime
			};
		}

		if (clientActivity.total > this.config.requests) {
			return {
				ok: false,
				requests: clientActivity.total,
				reset: resetTime
			};
		}

		return {
			ok: true,
			requests: clientActivity.total,
			reset: resetTime
		};
	}
}
