import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export function AnimatedCount({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <span className={className}>{value}</span>;
  }
  return (
    <span className={className} style={{ display: "inline-block", position: "relative" }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          style={{ display: "inline-block" }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
