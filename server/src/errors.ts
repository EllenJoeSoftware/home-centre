export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what = 'Not found'): HttpError => new HttpError(404, what);
export const badRequest = (msg: string): HttpError => new HttpError(400, msg);
