import {
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { useRef, type PointerEvent } from "react";

const GLOW_SIZE = 560;

/**
 * Сцена героя дня: пластина слегка следует за указателем, а по карточке ходит
 * пятно акцентного света. Двигаем только transform — это компоновочные свойства,
 * перекраска градиента на каждом кадре не нужна. Касания не трогаем: на телефоне
 * остаётся статичная композиция из CSS.
 */
export function useHeroStage() {
  const reduceMotion = useReducedMotion();
  /** Нормированное положение указателя: -1..1 по каждой оси. */
  const nx = useMotionValue(0);
  const ny = useMotionValue(0);
  /** Положение пятна в пикселях внутри карточки. */
  const gx = useMotionValue(0);
  const gy = useMotionValue(0);
  const settled = useRef(false);

  const snx = useSpring(nx, { stiffness: 80, damping: 18, mass: 0.6 });
  const sny = useSpring(ny, { stiffness: 80, damping: 18, mass: 0.6 });
  const sgx = useSpring(gx, { stiffness: 140, damping: 24, mass: 0.5 });
  const sgy = useSpring(gy, { stiffness: 140, damping: 24, mass: 0.5 });

  const artX = useTransform(snx, [-1, 1], [-18, 18]);
  const artY = useTransform(sny, [-1, 1], [-13, 13]);
  const artRotate = useTransform(snx, [-1, 1], [-7, 7]);
  // Motion пишет в x/y смещение, поэтому центр круга смещаем на половину его размера.
  const glowX = useTransform(sgx, (value) => value - GLOW_SIZE / 2);
  const glowY = useTransform(sgy, (value) => value - GLOW_SIZE / 2);

  const track = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    nx.set(((event.clientX - rect.left) / rect.width) * 2 - 1);
    ny.set(((event.clientY - rect.top) / rect.height) * 2 - 1);
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    if (!settled.current) {
      // Первый вход: ставим пятно под курсор сразу, без пролёта через угол.
      gx.jump(px);
      gy.jump(py);
      settled.current = true;
    } else {
      gx.set(px);
      gy.set(py);
    }
  };

  const onPointerLeave = () => {
    nx.set(0);
    ny.set(0);
  };

  return {
    /** Обработчики для карточки-героя. */
    stage: { onPointerEnter: track, onPointerMove: track, onPointerLeave },
    /** Стиль для слоя с пластиной. */
    artStyle: reduceMotion
      ? undefined
      : { x: artX, y: artY, rotate: artRotate },
    /** Стиль для пятна света. */
    glowStyle: { x: glowX, y: glowY },
  };
}
