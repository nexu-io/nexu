import type { ImgHTMLAttributes } from "react";

type BrandMarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">;

export function BrandMark(props: BrandMarkProps) {
  return (
    <img src="/favicon/favicon.svg" {...props} alt="" aria-hidden="true" />
  );
}
