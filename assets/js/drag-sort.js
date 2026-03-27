export function makeSortable(listElement, { onReorder = () => {} } = {}) {
  if (!listElement) {
    return {
      destroy() {},
    };
  }

  let draggedItem = null;

  const handleDragStart = (event) => {
    const item = event.target.closest("[data-task-id]");
    if (!item) {
      return;
    }

    draggedItem = item;
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.dataset.taskId || "");
  };

  const handleDragEnd = () => {
    draggedItem?.classList.remove("is-dragging");
    draggedItem = null;
    for (const item of listElement.querySelectorAll("[data-task-id]")) {
      item.classList.remove("is-drop-target");
    }
  };

  const handleDragOver = (event) => {
    if (!draggedItem) {
      return;
    }

    event.preventDefault();
    const afterElement = getClosestAfterElement(listElement, event.clientY);
    for (const item of listElement.querySelectorAll("[data-task-id]")) {
      item.classList.toggle("is-drop-target", item === afterElement);
    }

    if (!afterElement) {
      listElement.append(draggedItem);
      return;
    }

    if (afterElement !== draggedItem) {
      listElement.insertBefore(draggedItem, afterElement);
    }
  };

  const handleDrop = (event) => {
    if (!draggedItem) {
      return;
    }

    event.preventDefault();
    const orderedIds = [...listElement.querySelectorAll("[data-task-id]")].map((item) => item.dataset.taskId).filter(Boolean);
    onReorder(orderedIds);
  };

  listElement.addEventListener("dragstart", handleDragStart);
  listElement.addEventListener("dragend", handleDragEnd);
  listElement.addEventListener("dragover", handleDragOver);
  listElement.addEventListener("drop", handleDrop);

  return {
    destroy() {
      listElement.removeEventListener("dragstart", handleDragStart);
      listElement.removeEventListener("dragend", handleDragEnd);
      listElement.removeEventListener("dragover", handleDragOver);
      listElement.removeEventListener("drop", handleDrop);
    },
  };
}

function getClosestAfterElement(container, y) {
  const elements = [...container.querySelectorAll("[data-task-id]:not(.is-dragging)")];

  return elements.reduce(
    (closest, element) => {
      const box = element.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
        return { offset, element };
      }

      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null },
  ).element;
}
