import { clsx } from 'clsx';

export default function Screen(props: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'min-h-dvh bg-[radial-gradient(120%_120%_at_50%_0%,rgba(34,197,94,0.22)_0%,rgba(0,0,0,0)_60%),linear-gradient(180deg,#07150c_0%,#031006_100%)] text-white',
        props.className
      )}
    >
      {props.children}
    </div>
  );
}

