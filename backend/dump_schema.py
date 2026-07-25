import sys
import os

# Ensure the backend directory is in the path
sys.path.append(os.getcwd())

from sqlalchemy import create_mock_engine
from app.core.database import Base
from app.models.models import *  # Ensure all models are imported

def dump_sql(sql, *multiparams, **params):
    print(sql.compile(dialect=engine.dialect), end=";")

engine = create_mock_engine("postgresql://", dump_sql)

print("-- ROUTEIQ COMPLETE DATABASE SCHEMA --")
print("-- Generated from SQLAlchemy Models --\n")

# Use a separate print for the enums or rely on the mock engine
# Actually, the mock engine doesn't automatically print CREATE TYPE for Enums in some versions.
# I'll manually add the ENUM creation if needed, or check the output.

Base.metadata.create_all(engine)
