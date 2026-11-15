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

/** «1 рабочий подход», «2 рабочих подхода», «5 рабочих подходов», «21 рабочий подход». */
export function workingSets(value: number) {
  return quantity(value, "рабочий подход", "рабочих подхода", "рабочих подходов");
}

/** «подход / подхода / подходов» без числа и без «рабочих»: подпись под числом на карточке тренировки. */
export function setsWord(value: number) {
  return quantityWord(value, "подход", "подхода", "подходов");
}

/** То же без числа: для разметки вида `<strong>N</strong> рабочих подходов`. */
export function workingSetsWord(value: number) {
  return quantityWord(value, "рабочий подход", "рабочих подхода", "рабочих подходов");
}
