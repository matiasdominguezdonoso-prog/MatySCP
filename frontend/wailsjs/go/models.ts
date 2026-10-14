export namespace main {
	
	export class Hop {
	    name: string;
	    host: string;
	    port: number;
	    user: string;
	    password?: string;
	    use_pivot_key?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Hop(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.use_pivot_key = source["use_pivot_key"];
	    }
	}
	export class LocalFile {
	    name: string;
	    size: number;
	    is_dir: boolean;
	    mod_time: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.is_dir = source["is_dir"];
	        this.mod_time = source["mod_time"];
	    }
	}
	export class RemoteFile {
	    name: string;
	    size: number;
	    is_dir: boolean;
	    mod_time: string;
	
	    static createFrom(source: any = {}) {
	        return new RemoteFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.is_dir = source["is_dir"];
	        this.mod_time = source["mod_time"];
	    }
	}
	export class Site {
	    id: string;
	    nombre: string;
	    hops: Hop[];
	
	    static createFrom(source: any = {}) {
	        return new Site(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.nombre = source["nombre"];
	        this.hops = this.convertValues(source["hops"], Hop);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

