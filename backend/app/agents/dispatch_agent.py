from crewai import Agent, Task, Crew, Process
from langchain_openai import ChatOpenAI
import os

class DispatchAgent:
    def __init__(self):
        self.llm = ChatOpenAI(
            model=os.getenv("OPENAI_MODEL_NAME", "gpt-4-turbo-preview"),
            api_key=os.getenv("OPENAI_API_KEY")
        )

    def get_agent(self):
        return Agent(
            role='Fleet Dispatch Manager',
            goal='Optimize driver assignments and vehicle allocation for maximum efficiency',
            backstory="""You are an expert logistics coordinator at SealFreight Nexus. 
            You specialize in matching the right driver with the right vehicle for specific cargo types, 
            considering driver fatigue, route optimization, and vehicle capacity.""",
            verbose=True,
            allow_delegation=False,
            llm=self.llm
        )

    def create_dispatch_task(self, shipment_details, available_drivers, available_vehicles):
        return Task(
            description=f"""
            Analyze the following shipment: {shipment_details}
            Available Drivers: {available_drivers}
            Available Vehicles: {available_vehicles}
            
            Task: Assign the best driver and vehicle for this shipment.
            Consider:
            1. Vehicle capacity vs Shipment weight.
            2. Cargo type requirements (e.g., Cold Chain needs specialized trucks).
            3. Driver's current location and availability.
            4. Efficiency and fuel cost.
            
            Provide a detailed reasoning for your choice.
            """,
            expected_output="A JSON object containing driver_id, vehicle_id, and reasoning.",
            agent=self.get_agent()
        )

    def run_dispatch(self, shipment_details, available_drivers, available_vehicles):
        task = self.create_dispatch_task(shipment_details, available_drivers, available_vehicles)
        crew = Crew(
            agents=[self.get_agent()],
            tasks=[task],
            process=Process.sequential
        )
        return crew.kickoff()
