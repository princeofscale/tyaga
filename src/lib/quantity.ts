export function quantity(
  value: number,
  one: string,
  few: string,
  many: string,
) {
  return `${value} ${quantityWord(value, one, few, many)}`;
}

export function quantityWord(
  value: number,
  one: string,
  few: string,
  many: string,
) {
  const count = Math.abs(value);
  return count % 100 >= 11 && count % 100 <= 14
    ? many
    : count % 10 === 1
      ? one
      : count % 10 >= 2 && count % 10 <= 4
        ? few
        : many;
}
