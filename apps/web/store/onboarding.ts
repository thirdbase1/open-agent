import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export enum OnboardingStep {
  Welcome = 0,
  MultiAgent,
  TodoList,
  Showcase,
  Select,
  Register,
  Waiting,
}

export interface OnboardingState {
  visited: boolean;
  setVisited: (visited: boolean) => void;
  step: OnboardingStep;
  setStep: (step: OnboardingStep) => void;
  nextStep: () => void;
  prevStep: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      visited: false,
      setVisited: (visited: boolean) => set({ visited }),
      step: OnboardingStep.Welcome,
      setStep: (step: OnboardingStep) => set({ step }),
      nextStep: () => {
        const current = get().step;
        const next = Math.min(current + 1, OnboardingStep.Waiting);
        set({ step: next });
      },
      prevStep: () => {
        const current = get().step;
        const prev = Math.max(current - 1, OnboardingStep.Welcome);
        set({ step: prev });
      },
    }),
    {
      name: 'onboarding-storage',
      partialize: state => ({
        visited: state.visited,
      }),
    }
  )
);
