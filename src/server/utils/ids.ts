export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s));

export const paramUuid = (paramName: string) => (
  req: any,
  res: any,
  next: any
) => {
  const v = req.params?.[paramName];
  if (!isUuid(v)) {
    return res.status(400).json({ error: "invalid_id", param: paramName });
  }
  next();
};
