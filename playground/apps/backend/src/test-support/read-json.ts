export async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>
}
