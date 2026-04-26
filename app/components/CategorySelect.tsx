import { useEffect, useState, type ChangeEventHandler } from "react";
import { useYnab } from "~/hooks/ynab";

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

  const ynabApi = useYnab();

  const [categories, setCategories] = useState([] as Category[]);

  async function getCategories(): Promise<Category[]> {
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

  useEffect(() => {
    let ignore = false;

    async function startFetching() {
      getCategories().then((result) => {
        if (!ignore) {
          setCategories(result);
        }
      });
    }

    startFetching();

    return () => {
      ignore = true;
    }
  }, [ynabApi]);

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
