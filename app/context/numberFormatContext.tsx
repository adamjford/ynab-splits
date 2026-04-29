import { createContext, useContext, useState } from "react";

export const NumberFormatContext = createContext(null as Intl.NumberFormat | null);

export const NumberFormatProvider = ({ children }: React.PropsWithChildren) => {
  const [numberFormat, _] = useState(
    () => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }),
  );
  return (
    <NumberFormatContext.Provider value={numberFormat}>
      {children}
    </NumberFormatContext.Provider>
  );
};

export function useNumberFormat(): Intl.NumberFormat {
  const numberFormat: Intl.NumberFormat | null = useContext(NumberFormatContext);

  if (!numberFormat) {
    throw new Error("No number format set.")
  }

  return numberFormat;
}

