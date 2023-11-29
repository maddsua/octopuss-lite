
export interface OriginManagerConfig {
	origins: string[];
	respondCORS: boolean;
};

export interface OriginManagerOptions extends Partial<OriginManagerConfig> {
	enabled: boolean;
};
