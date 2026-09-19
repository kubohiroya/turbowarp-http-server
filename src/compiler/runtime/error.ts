export class IrRuntimeError extends Error {
  public readonly name = 'IrRuntimeError';

  public constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number
  ) {
    super(message);
  }
}
