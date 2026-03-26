declare module "express" {
  namespace express {
    interface Response {
      json(body: unknown): Response;
      status(code: number): Response;
      send(body: string): Response;
      sendFile(path: string): void;
    }

    interface Application {
      use(...args: any[]): Application;
      get(...args: any[]): Application;
    }
  }

  interface ExpressModule {
    (): express.Application;
    static(root: string): (...args: any[]) => void;
  }

  const express: ExpressModule;
  export = express;
}

declare module "cors" {
  interface CorsFactory {
    (...args: any[]): (...args: any[]) => void;
  }

  const cors: CorsFactory;
  export = cors;
}
