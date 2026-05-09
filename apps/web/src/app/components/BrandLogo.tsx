import { clsx } from 'clsx';

type BrandLogoProps = {
  className?: string;
  alt?: string;
};

export default function BrandLogo({ className, alt = 'BigBottle' }: BrandLogoProps) {
  return (
    <img
      src="/bigbottle-logo-header.png"
      alt={alt}
      decoding="async"
      className={clsx('block aspect-square shrink-0 rounded-[22%] object-cover', className)}
    />
  );
}
