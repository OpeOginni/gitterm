import Image from "next/image";

/** A small product or provider logo. The landing sizes these with CSS, so no optimisation. */
export function Logo({
  src,
  alt = "",
  className,
  ...rest
}: { src: string; alt?: string; className?: string } & Record<`data-${string}`, boolean | string>) {
  return (
    <Image src={src} alt={alt} width={28} height={28} unoptimized className={className} {...rest} />
  );
}
