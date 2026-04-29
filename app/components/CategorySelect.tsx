import { useEffect, useState, type ChangeEventHandler } from "react";
import type { api as YnabApi } from "ynab";
import { useYnabFetchEffect } from "~/hooks/ynab/useYnabFetchEffect";

export function CategorySelect({
  name,
  className,
  selectedCategoryId,
  onChange
}: {
  name?: string,
  className?: string,
  selectedCategoryId?: string,
  onChange?: ChangeEventHandler<HTMLSelectElement>
}) {
  interface Category {
    id: string;
    name: string;
    group_id: string;
    group_name: string;
  }

  const [categories, setCategories] = useState([] as Category[]);

  async function getCategories(ynabApi: YnabApi): Promise<Category[]> {
    const categoriesResponse = await ynabApi.categories.getCategories("default");
    return categoriesResponse.data.category_groups
      .filter(group => !group.deleted && !group.hidden)
      .flatMap(group => {
        return group.categories
          .filter(category =>
            !category.deleted &&
            !category.hidden &&
            category.name.toLowerCase().includes("settling up"))
          .map(function (category): Category {
            return {
              id: category.id,
              name: category.name,
              group_id: group.id,
              group_name: group.name,
            };
          });
      });
  }

  useYnabFetchEffect(
    getCategories,
    setCategories
  )

  if (!categories) {
    return null;
  }

  return (
    <select
      name={name}
      value={selectedCategoryId}
      onChange={onChange}
      className={className}>
      <option key={null} value="">-- Select a category--</option>
      {categories.map((category) =>
        <option key={category.id} value={category.id}>{category.group_name} - {category.name}</option>
      )}
    </select>
  );
}
