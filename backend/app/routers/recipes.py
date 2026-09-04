import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Recipe, RecipeKind
from ..schemas import RecipeCreate, RecipeOut, RecipeUpdate

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


def get_recipe_or_404(db: Session, recipe_id: uuid.UUID) -> Recipe:
    recipe = db.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(404, f"配方不存在：{recipe_id}")
    return recipe


@router.post("", status_code=201, response_model=RecipeOut)
def create_recipe(body: RecipeCreate, db: Session = Depends(get_db)):
    recipe = Recipe(
        kind=body.kind,
        name=body.name,
        description=body.description,
        content=body.content,
        meta=body.meta,
        created_by=body.created_by,
    )
    db.add(recipe)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"配方名已存在：{body.name}")
    db.refresh(recipe)
    return recipe


@router.get("", response_model=list[RecipeOut])
def list_recipes(kind: RecipeKind | None = None, db: Session = Depends(get_db)):
    stmt = select(Recipe).order_by(Recipe.created_at)
    if kind:
        stmt = stmt.where(Recipe.kind == kind)
    return list(db.scalars(stmt))


@router.get("/{recipe_id}", response_model=RecipeOut)
def get_recipe(recipe_id: uuid.UUID, db: Session = Depends(get_db)):
    return get_recipe_or_404(db, recipe_id)


@router.put("/{recipe_id}", response_model=RecipeOut)
def update_recipe(recipe_id: uuid.UUID, body: RecipeUpdate,
                  db: Session = Depends(get_db)):
    recipe = get_recipe_or_404(db, recipe_id)
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(recipe, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"配方名已存在：{data.get('name')}")
    db.refresh(recipe)
    return recipe


@router.delete("/{recipe_id}", status_code=204)
def delete_recipe(recipe_id: uuid.UUID, db: Session = Depends(get_db)):
    recipe = get_recipe_or_404(db, recipe_id)
    db.delete(recipe)
    db.commit()
