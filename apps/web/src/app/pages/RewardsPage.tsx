import Screen from '../components/Screen';
import BottomTabBar from '../components/BottomTabBar';

export default function RewardsPage() {
  return (
    <Screen>
      <div className="mx-auto min-h-dvh max-w-[420px] px-5 pb-32 pt-10">
        <div className="text-lg font-semibold tracking-tight">Rewards</div>
        <div className="mt-2 text-sm text-white/55">Coming soon</div>
      </div>

      <BottomTabBar />
    </Screen>
  );
}

