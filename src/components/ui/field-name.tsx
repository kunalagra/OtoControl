import { createContext, useContext } from "react"

/**
 * The accessible name a surrounding row gives its control. SettingRow provides
 * it so a Switch or SelectTrigger inside the row is named without every call
 * site repeating the label as aria-label.
 */
const FieldNameContext = createContext<string | undefined>(undefined)

const FieldNameProvider = FieldNameContext.Provider

function useFieldName(): string | undefined {
  return useContext(FieldNameContext)
}

export { FieldNameProvider, useFieldName }
